import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
    probability: number;
    condition: "Oxidation" | "Acidic Hydrolysis" | "Basic Hydrolysis" | "Photodegradation" | "Thermal Degradation";
    source: "Stress degradation" | "Interaction with other compound";
  }[];
}

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
  inputs: CompoundInput[]
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Predict and evaluate the degradation of Compound 1 in the following mixture:\n${compoundsInfo}`,
      config: {
        systemInstruction: `You are an expert pharmaceutical scientist specializing in drug stability and drug-excipient compatibility (DEC). 
        Your task is to predict the degradation of Compound 1 specifically.
        
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
        - SMILES string (MUST be a valid, standard, canonical SMILES string compatible with RDKit and PubChem. DO NOT include spaces or line breaks. Ensure all parentheses are balanced and all ring closures are correctly numbered).
        - List of key structural features.
        - List of specific "Interaction Sites" (e.g., "Carbonyl oxygen", "Primary amine group", "Alpha-carbon to the ester") that are likely to be involved in degradation or interaction.
        
        Predict exactly 10 possible degradation impurities or interaction products derived from Compound 1.
        For each product, you MUST specify:
        - Whether it forms from "Stress degradation" or "Interaction with other compound".
        - Which specific condition it forms under (Oxidation, Acidic Hydrolysis, Basic Hydrolysis, Photodegradation, or Thermal Degradation).
        - IUPAC name, SMILES string (MUST be valid, canonical, contain NO spaces, and have perfectly balanced parentheses).
        - Probability of formation based on chemical stability principles.
        
        Rank the products by their calculated probability.`,
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
                properties: {
                  iupacName: { type: Type.STRING },
                  smiles: { type: Type.STRING },
                  structureDescription: { type: Type.STRING },
                  origin: { type: Type.STRING },
                  probability: { type: Type.NUMBER },
                  condition: { 
                    type: Type.STRING, 
                    enum: ["Oxidation", "Acidic Hydrolysis", "Basic Hydrolysis", "Photodegradation", "Thermal Degradation"] 
                  },
                  source: { 
                    type: Type.STRING, 
                    enum: ["Stress degradation", "Interaction with other compound"] 
                  }
                },
                required: ["iupacName", "smiles", "structureDescription", "origin", "probability", "condition", "source"]
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
    if (error.message?.includes("quota") || error.message?.includes("429")) {
      throw new AnalysisError("API rate limit reached. The free tier of Gemini has a limit on requests per minute. Please wait 60 seconds and try again.", "RATE_LIMIT");
    }
    if (error.message?.includes("network") || error.message?.includes("fetch")) {
      throw new AnalysisError("Network error. Please check your internet connection or try again later.", "NETWORK_ERROR");
    }
    if (error.message?.includes("overloaded") || error.status === 503) {
      throw new AnalysisError("The AI model is currently overloaded. Please try again in a few seconds.", "MODEL_OVERLOADED");
    }

    // Default error
    throw new AnalysisError(error.message || "An unexpected error occurred during chemical analysis.", "UNKNOWN_ERROR");
  }
}
