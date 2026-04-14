import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  // Try both standard and VITE_ prefixed variables
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  
  if (!key || key === "INVALID_OR_MISSING_KEY") {
    if (typeof window !== "undefined") {
      console.error("❌ GEMINI_API_KEY is missing.");
      console.log("1. AI Studio: Click the gear icon (Settings) -> Secrets -> Add GEMINI_API_KEY.");
      console.log("2. Vercel: Add VITE_GEMINI_API_KEY to your Project Settings and redeploy.");
    }
    return "MISSING_KEY";
  }
  return key;
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export interface CompoundInfo {
  name: string;
  smiles: string;
  features: string[];
  interactionSites: string[];
}

export interface PredictionResult {
  compounds: CompoundInfo[];
  interactionType: "Physical" | "Chemical" | "None";
  mechanism: string;
  degradationImpurities: {
    iupacName: string;
    smiles: string;
    structureDescription: string;
    origin: string;
    probability: number; // Primary probability for ranking
    probabilityHeuristic?: number;
    probabilityBoltzmann?: number;
    relativeEnergy?: number;
    condition: "Oxidation" | "Acidic Hydrolysis" | "Basic Hydrolysis" | "Photodegradation" | "Thermal Degradation";
    source: "Stress degradation" | "Interaction with other compound";
  }[];
}

export type PredictionMethod = "Boltzmann" | "Heuristic" | "Both";

export type InputType = "Name" | "SMILES" | "SMARTS" | "InChI";

export class AnalysisError extends Error {
  constructor(public message: string, public type: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

export interface CompoundInput {
  value: string;
  type: InputType;
}

export async function predictInteraction(
  inputs: CompoundInput[],
  method: PredictionMethod = "Heuristic"
): Promise<PredictionResult> {
  // Pre-validation
  for (const input of inputs) {
    if (input.type === "SMILES") {
      const smiles = input.value.trim();
      if (smiles.includes(" ")) {
        throw new AnalysisError("SMILES strings cannot contain spaces. Please check your input.", "INVALID_SMILES");
      }
      // Basic parenthesis check
      let balance = 0;
      for (const char of smiles) {
        if (char === "(") balance++;
        if (char === ")") balance--;
        if (balance < 0) break;
      }
      if (balance !== 0) {
        throw new AnalysisError("The SMILES string has unbalanced parentheses. Please check the chemical structure.", "INVALID_SMILES");
      }
    }
  }

  const compoundsInfo = inputs
    .map((input, i) => `Compound ${i + 1}: "${input.value}" (provided as ${input.type})`)
    .join("\n    ");

  let probabilityInstruction = "";
  if (method === "Boltzmann") {
    probabilityInstruction = "Probability of formation based on Boltzmann distribution at 298K. You MUST also provide the estimated relative formation energy (relativeEnergy) in kcal/mol.";
  } else if (method === "Heuristic") {
    probabilityInstruction = "Probability of formation based on chemical stability principles and heuristic reasoning.";
  } else if (method === "Both") {
    probabilityInstruction = "Provide BOTH 'probabilityHeuristic' (based on expert reasoning) and 'probabilityBoltzmann' (based on thermodynamic ΔG at 298K). You MUST also provide 'relativeEnergy' in kcal/mol. The main 'probability' field should match 'probabilityBoltzmann' for ranking purposes.";
  }

  const impurityProperties: any = {
    iupacName: { type: Type.STRING },
    smiles: { type: Type.STRING },
    structureDescription: { type: Type.STRING },
    origin: { type: Type.STRING },
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
    }
  };

  const requiredImpurityFields = ["iupacName", "smiles", "structureDescription", "origin", "probability", "condition", "source"];

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Predict and evaluate the degradation of Compound 1 in the following mixture using the ${method === "Both" ? "Heuristic AND Boltzmann" : method}-based approach:\n${compoundsInfo}`,
      config: {
        systemInstruction: `You are a professional pharmaceutical degradation evaluator. 
        Your task is to predict the degradation of Compound 1 using two distinct and independent analytical frameworks:
        
        1. HEURISTIC ANALYSIS: Based on expert chemical reasoning, reactive site identification, and known reaction kinetics.
        2. BOLTZMANN ANALYSIS: Based on thermodynamic stability and calculated relative formation energy (ΔG) at 298K.
        
        When "Both" is selected, you must perform these two analyses independently for each predicted impurity to provide a comparative perspective.
        
        Evaluate the degradation of Compound 1 due to:
        1. Stress degradation of Compound 1.
        2. Interactions between Compound 1 and any other provided compounds (Compounds 2-5).
        
        You MUST evaluate degradation under these specific conditions:
        - Oxidation
        - Acidic Hydrolysis
        - Basic Hydrolysis
        - Photodegradation
        - Thermal Degradation
        
        First, identify the chemical structures correctly for ALL provided compounds.
        For each compound, provide:
        - Identified name.
        - SMILES string (MUST be a valid, standard, canonical SMILES string compatible with RDKit and PubChem).
        - List of key structural features.
        - List of specific "Interaction Sites" likely to be involved in degradation.
        
        Predict exactly 10 possible degradation impurities or interaction products derived from Compound 1.
        For each product, you MUST specify:
        - Whether it forms from "Stress degradation" or "Interaction with other compound".
        - Which specific condition it forms under.
        - IUPAC name, SMILES string (MUST be valid, canonical).
        - ${probabilityInstruction}
        
        IMPORTANT: Probabilities MUST be realistic estimates between 0.01 and 0.99. DO NOT return 0.0 unless the impurity is chemically impossible.
        
        Rank the products by their calculated Boltzmann probability (if available) or general probability.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            compounds: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  smiles: { type: Type.STRING },
                  features: { type: Type.ARRAY, items: { type: Type.STRING } },
                  interactionSites: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "Specific chemical sites/groups likely to interact or degrade"
                  }
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
          required: ["compounds", "interactionType", "mechanism", "degradationImpurities"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new AnalysisError("The model failed to generate a response. Please try again.", "EMPTY_RESPONSE");
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("JSON Parse Error:", text);
      throw new AnalysisError("The model generated an invalid chemical report. This can happen with very complex structures. Please try again.", "INVALID_JSON");
    }
  } catch (error: any) {
    if (error instanceof AnalysisError) throw error;

    console.error("Gemini API Error:", error);
    
    // Handle specific Gemini error cases
    if (error.message?.includes("SAFETY")) {
      throw new AnalysisError("The input contains content that triggered safety filters. Please check your compound names or structures.", "SAFETY_TRIGGERED");
    }

    // Check for rate limit (429) or quota errors
    const isRateLimit = error.message?.includes("quota") || 
                        error.message?.includes("429") || 
                        error.status === 429 ||
                        error.message?.toLowerCase().includes("rate limit");

    if (isRateLimit) {
      throw new AnalysisError("API rate limit reached. The free tier of Gemini has a limit on requests per minute. Please wait 60 seconds and try again. If this persists, it may be due to high global usage on the free tier.", "RATE_LIMIT");
    }

    if (error.message?.includes("network") || error.message?.includes("fetch")) {
      throw new AnalysisError("Network error. Please check your internet connection or try again later.", "NETWORK_ERROR");
    }
    
    if (error.message?.includes("overloaded") || error.status === 503) {
      throw new AnalysisError("The AI model is currently overloaded. Please try again in a few seconds.", "MODEL_OVERLOADED");
    }

    if (error.message?.includes("API key not valid")) {
      throw new AnalysisError("The Gemini API key is invalid. Please check your environment variables.", "INVALID_KEY");
    }

    // Default error with more context
    const errorMessage = error.message || "An unexpected error occurred during chemical analysis.";
    throw new AnalysisError(`${errorMessage} (Error Type: ${error.name || "Unknown"})`, "UNKNOWN_ERROR");
  }
}
