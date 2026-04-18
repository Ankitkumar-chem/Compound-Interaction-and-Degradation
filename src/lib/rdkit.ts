interface RDKitModule {
  get_mol: (smiles: string) => RDKitMolecule | null;
  get_qmol: (smarts: string) => RDKitMolecule | null;
}

interface RDKitMolecule {
  is_valid: () => boolean;
  get_smiles: () => string;
  delete: () => void;
  get_inchi?: () => string;
  get_descriptors: () => string;
}

export interface MolecularDescriptors {
  MolWt?: number;
}

let rdkitModule: RDKitModule | null = null;
let initializationPromise: Promise<RDKitModule> | null = null;

export async function initRDKit(): Promise<RDKitModule> {
  if (rdkitModule) return rdkitModule;
  if (initializationPromise) return initializationPromise;

  initializationPromise = new Promise((resolve, reject) => {
    // @ts-ignore
    if (window.initRDKitModule) {
      // @ts-ignore
      window.initRDKitModule()
        .then((module: RDKitModule) => {
          rdkitModule = module;
          resolve(module);
        })
        .catch(reject);
    } else {
      // Fallback: try to load from CDN if not bundled
      const script = document.createElement("script");
      script.src = "https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js";
      script.onload = () => {
        // @ts-ignore
        window.initRDKitModule()
          .then((module: RDKitModule) => {
            rdkitModule = module;
            resolve(module);
          })
          .catch(reject);
      };
      script.onerror = () => reject(new Error("Failed to load RDKit script"));
      document.head.appendChild(script);
    }
  });

  return initializationPromise;
}

export async function validateSmiles(smiles: string): Promise<{ isValid: boolean; canonicalSmiles?: string; error?: string }> {
  try {
    const rdkit = await initRDKit();
    const mol = rdkit.get_mol(smiles);
    if (!mol) {
      return { isValid: false, error: "Invalid chemical structure (RDKit could not parse SMILES)" };
    }
    const isValid = mol.is_valid();
    const canonical = mol.get_smiles();
    mol.delete();
    
    if (!isValid) {
      return { isValid: false, error: "Chemical structure is invalid (Valence or bonding errors)" };
    }
    
    return { isValid: true, canonicalSmiles: canonical };
  } catch (err) {
    console.error("RDKit Validation Error:", err);
    return { isValid: false, error: "Validation engine error" };
  }
}

export async function validateSmarts(smarts: string): Promise<{ isValid: boolean; error?: string }> {
  try {
    const rdkit = await initRDKit();
    const qmol = rdkit.get_qmol(smarts);
    if (!qmol) {
      return { isValid: false, error: "Invalid SMARTS pattern" };
    }
    const isValid = qmol.is_valid();
    qmol.delete();
    return { isValid };
  } catch (err) {
    return { isValid: false, error: "Validation engine error" };
  }
}

export async function getMolecularDescriptors(smiles: string): Promise<MolecularDescriptors | null> {
  try {
    const rdkit = await initRDKit();
    let mol = rdkit.get_mol(smiles);
    
    // Fallback: try to canonicalize if first attempt fails
    if (!mol || !mol.is_valid()) {
      if (mol) mol.delete();
      return null;
    }
    
    const descriptorsJson = mol.get_descriptors();
    const raw = JSON.parse(descriptorsJson);
    mol.delete();
    
    // Normalize keys - only keep Molecular Weight as requested
    const normalized: MolecularDescriptors = {
      MolWt: raw.MolWt ?? raw.amw ?? raw.MolWeight ?? raw.mw,
    };
    
    return normalized;
  } catch (err) {
    console.error("RDKit Descriptors Error:", err);
    return null;
  }
}
