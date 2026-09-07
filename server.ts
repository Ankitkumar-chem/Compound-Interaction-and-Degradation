import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { parse as parsePartial } from "partial-json";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));

// In-memory sliding-window IP rate limiter to prevent abuse and quota exhaustion
interface RateRecord {
  count: number;
  resetTime: number;
}
const rateLimits = new Map<string, RateRecord>();

function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimits.get(ip);
  if (!record || now > record.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (record.count >= limit) {
    return false;
  }
  record.count++;
  return true;
}

// Clean up expired rate records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now > record.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 300000);

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MISSING_KEY" || apiKey === "INVALID_OR_MISSING_KEY") {
    throw new Error("GEMINI_API_KEY is not configured on the server. Please set it in Settings/Secrets.");
  }
  return new GoogleGenAI({ apiKey });
};

// ==========================================
// 1. Prediction Endpoint (Streaming SSE)
// ==========================================
app.post("/api/predict", async (req: Request, res: Response) => {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  
  // Rate limit: Max 20 predictions per minute per IP
  if (!checkRateLimit(`predict:${clientIp}`, 20, 60000)) {
    return res.status(429).json({ error: "Rate limit exceeded. Please wait 60 seconds before making more predictions." });
  }

  const { inputs, method = "Heuristic" } = req.body;

  // Strict input validation
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 5) {
    return res.status(400).json({ error: "Invalid inputs: Provide between 1 and 5 compounds." });
  }

  for (const input of inputs) {
    if (!input || typeof input.value !== "string" || input.value.trim().length === 0 || input.value.length > 1000) {
      return res.status(400).json({ error: "Invalid compound value. Must be a non-empty string under 1000 characters." });
    }
    if (input.type !== "Name" && input.type !== "SMILES") {
      return res.status(400).json({ error: "Invalid input type. Must be 'Name' or 'SMILES'." });
    }
  }

  const validMethods = ["Boltzmann", "Heuristic", "Both"];
  if (!validMethods.includes(method)) {
    return res.status(400).json({ error: "Invalid prediction method." });
  }

  // Setup Server-Sent Events (SSE) for secure real-time streaming to the browser
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendSse = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const compoundsInfo = inputs
      .map((input: any, i: number) => {
        let desc = "";
        if (input.descriptors) {
          desc = ` [Calculated Specs: MolWt: ${input.descriptors.MolWt?.toFixed(2) || "N/A"}, LogP: ${input.descriptors.MolLogP?.toFixed(2) || "N/A"}, TPSA: ${input.descriptors.TPSA?.toFixed(2) || "N/A"}, Rotatable Bonds: ${input.descriptors.NumRotatableBonds ?? "N/A"}]`;
        }
        const compoundTargetName = input.originalName || (input.type === "Name" ? input.value : `Compound ${i + 1}`);
        const rawType = input.type === "SMILES" ? `SMILES Structure Data: ${input.value}` : `"${input.value}" (provided as Name)`;
        const constraint = ` The user specifically named this compound "${compoundTargetName}". You MUST strictly fill out the 'name' field using exactly "${compoundTargetName}"... DO NOT under any circumstances output 'Compound ${i + 1}' or its IUPAC name for the Input Compound name.`;
        return `Compound ${i + 1}: ${rawType}.${constraint}${desc}`;
      })
      .join("\n    ");

    let probabilityInstruction = "";
    if (method === "Boltzmann") {
      probabilityInstruction = "Probability of formation based on Boltzmann distribution at 298.15K. You MUST also provide the estimated relative formation energy (relativeEnergy) in kcal/mol.";
    } else if (method === "Heuristic") {
      probabilityInstruction = "Probability of formation based on chemical stability principles and heuristic reasoning.";
    } else if (method === "Both") {
      probabilityInstruction = "Provide BOTH 'probabilityHeuristic' (based on expert reasoning) and 'probabilityBoltzmann' (based on thermodynamic ΔG at 298.15K). You MUST also provide 'relativeEnergy' in kcal/mol. The main 'probability' field should match 'probabilityBoltzmann' for ranking purposes.";
    }

    const impurityProperties: any = {
      iupacName: { type: Type.STRING, description: "The IUPAC name or common name of the NEW REACTION OR DEGRADATION PRODUCT. DO NOT just output the parent compound name. You must name the new product generated." },
      smiles: { 
        type: Type.STRING, 
        description: "SMILES string of the newly formed product. CRITICAL WARNING: You must mathematically ensure standard valence rules are obeyed. Do not attach 5 bonds to Carbon. RDKit will fail to parse this if valences are exceeded."
      },
      structureDescription: { type: Type.STRING },
      origin: { type: Type.STRING, description: "Which specific compound(s) this product originated from. E.g. 'Compound 1 and Compound 2'" },
      probability: { 
        type: Type.NUMBER, 
        description: "Primary probability of formation as a decimal between 0.0 and 1.0 (e.g., 0.85 for 85%). Used for ranking." 
      },
      condition: { 
        type: Type.STRING, 
        enum: ["Oxidation", "Acidic Hydrolysis", "Basic Hydrolysis", "Photodegradation", "Thermal Degradation"] 
      },
      source: { 
        type: Type.STRING, 
        enum: ["Stress degradation", "Interaction with other compound"] 
      },
      mechanismExplanation: {
        type: Type.STRING,
        description: "Brief explanation of the interaction mechanism (e.g., pH change, oxidation, complexation, adsorption, precipitation). Mention effects on stability or release kinetics."
      }
    };

    const requiredImpurityFields = ["iupacName", "smiles", "structureDescription", "origin", "probability", "condition", "source", "mechanismExplanation"];

    if (method === "Boltzmann" || method === "Both") {
      impurityProperties.relativeEnergy = { type: Type.NUMBER, description: "Relative formation energy in kcal/mol" };
      requiredImpurityFields.push("relativeEnergy");
    }

    if (method === "Both") {
      impurityProperties.probabilityHeuristic = { 
        type: Type.NUMBER, 
        description: "Heuristic-based probability as a decimal between 0.0 and 1.0" 
      };
      impurityProperties.probabilityBoltzmann = { 
        type: Type.NUMBER, 
        description: "Boltzmann-based probability as a decimal between 0.0 and 1.0" 
      };
      requiredImpurityFields.push("probabilityHeuristic", "probabilityBoltzmann");
    }

    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"];
    const maxRetries = 2;
    let fullText = "";

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const activeModel = modelsToTry[mIdx];
      let attempt = 0;
      let success = false;

      while (attempt <= maxRetries && !success) {
        try {
          const ai = getAiClient();
          const responseStream = await ai.models.generateContentStream({
            model: activeModel,
            contents: `Predict and evaluate the chemical interaction and reaction products of Compound 1 in the following mixture using the ${method === "Both" ? "Heuristic AND Boltzmann" : method}-based approach:\n${compoundsInfo}`,
            config: {
              temperature: 0.1,
              systemInstruction: `You are an expert computational chemist and reaction mechanism evaluator. 
Your task is to predict the chemical interaction and transformation products of Compound 1 using the following analytical framework${method === "Both" ? "s" : ""}:
${method === "Heuristic" || method === "Both" ? "\n1. HEURISTIC ANALYSIS: Based on expert chemical reasoning, reactive site identification, and known reaction kinetics." : ""}
${method === "Boltzmann" || method === "Both" ? `\n${method === "Both" ? "2." : "1."} BOLTZMANN ANALYSIS: Based on thermodynamic stability and calculated relative formation energy (ΔG) at 298.15K.` : ""}

${method === "Both" ? "When \"Both\" is selected, you must perform these two analyses independently for each predicted product to provide a comparative perspective." : ""}

Evaluate the chemical reactivity and transformation of Compound 1 due to:
1. Direct degradation / intrinsic reactivity of Compound 1.
2. Chemical interactions between Compound 1 and any other provided co-reactants (Compounds 2-5).

You MUST evaluate reactivity under these specific conditions:
- Oxidation
- Acidic Hydrolysis
- Basic Hydrolysis
- Photodegradation
- Thermal Degradation

First, identify the chemical structures correctly for ALL provided compounds.
For each compound, provide:
- Identified name (If the user explicitly provided a name, you MUST echo their exact original name back to them. DO NOT rename it to IUPAC or another common name).
- SMILES string (MUST be a valid, standard, canonical SMILES string compatible with RDKit and PubChem).
- List of key structural features.
- List of specific "Interaction Sites" likely to be involved in reaction or degradation.

Predict ONLY the TOP 5 most significant reaction byproducts, degradation products, or interaction adducts derived from Compound 1.
For each product, you MUST specify:
- Whether it forms from "Direct degradation" or "Interaction with other compound".
- Which specific condition it forms under.
- IUPAC name of the NEW PRODUCT.
- SMILES string of the new product (valid canonical SMILES obeying valences).
- A brief explanation of the underlying mechanism (mechanismExplanation).
- ${probabilityInstruction}

IMPORTANT: Probabilities MUST be realistic estimates between 0.01 and 0.99.
Rank the products by their calculated Boltzmann probability (if available) or general probability. Do not return more than 5 products.`,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  chainOfThought: {
                    type: Type.STRING,
                    description: `Perform your step-by-step chemical reasoning, reaction pathway derivation${method !== "Heuristic" ? ", and energy estimation" : ""} here BEFORE outputting the final compounds.`
                  },
                  compounds: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        smiles: { type: Type.STRING },
                        features: { type: Type.ARRAY, items: { type: Type.STRING } },
                        interactionSites: { type: Type.ARRAY, items: { type: Type.STRING } }
                      },
                      required: ["name", "smiles", "features", "interactionSites"]
                    }
                  },
                  interactionType: { type: Type.STRING, enum: ["Physical", "Chemical", "None"] },
                  mechanism: { type: Type.STRING },
                  degradationImpurities: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: impurityProperties,
                      required: requiredImpurityFields
                    }
                  }
                },
                required: ["chainOfThought", "compounds", "interactionType", "mechanism", "degradationImpurities"]
              }
            }
          });

          fullText = "";
          for await (const chunk of responseStream) {
            if (chunk.text) {
              fullText += chunk.text;
              try {
                const partial = parsePartial(fullText);
                if (partial) {
                  sendSse("chunk", partial);
                }
              } catch (_) {}
            }
          }

          if (fullText) {
            const parsed = JSON.parse(fullText);
            if (parsed && Array.isArray(parsed.degradationImpurities)) {
              parsed.degradationImpurities = parsed.degradationImpurities.slice(0, 5);
            }
            sendSse("complete", parsed);
            success = true;
            break;
          }
        } catch (err: any) {
          attempt++;
          if (attempt <= maxRetries) {
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
      }

      if (success) break;
    }

    if (!fullText) {
      sendSse("error", { message: "The model failed to generate a complete report. Please try again." });
    }
  } catch (error: any) {
    console.error("Server Prediction Error:", error);
    sendSse("error", { message: error.message || "An error occurred while generating predictions." });
  } finally {
    res.end();
  }
});

// ==========================================
// 2. SMILES Remediation Endpoint
// ==========================================
app.post("/api/remediate-smiles", async (req: Request, res: Response) => {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  
  // Rate limit: Max 60 remediations per minute per IP
  if (!checkRateLimit(`remediate:${clientIp}`, 60, 60000)) {
    return res.status(429).json({ error: "Rate limit exceeded for SMILES lookup." });
  }

  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return res.status(400).json({ error: "Invalid compound name." });
  }

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `Provide the valid, canonical SMILES string for the compound named "${name.trim()}". Return ONLY the SMILES string.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            smiles: { type: Type.STRING }
          },
          required: ["smiles"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return res.json({ smiles: result.smiles || null });
  } catch (error: any) {
    console.error("Server SMILES Remediation Error:", error);
    return res.status(500).json({ error: error.message || "Failed to remediate SMILES." });
  }
});

// ==========================================
// 3. Vite Middleware & Asset Serving
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running securely on port ${PORT}`);
  });
}

startServer();
