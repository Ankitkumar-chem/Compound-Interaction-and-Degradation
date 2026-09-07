import { updateCompoundSmiles } from './firestore-utils';

/**
 * Dynamically resolves a missing SMILES string using the secure server backend
 * and updates the Firestore database without exposing API credentials.
 */
export async function remediateCompoundSmiles(docId: string, name: string): Promise<string | null> {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return null;
  }

  try {
    const response = await fetch('/api/remediate-smiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: name.trim() })
    });

    if (!response.ok) {
      console.warn(`SMILES remediation service returned status ${response.status} for "${name}".`);
      return null;
    }

    const data = await response.json();
    const smiles = data.smiles;

    if (smiles && typeof smiles === 'string' && smiles.trim().length > 0) {
      await updateCompoundSmiles(docId, smiles.trim());
      return smiles.trim();
    }
    return null;
  } catch (error: any) {
    console.error(`Failed to remediate SMILES for ${name}:`, error);
    return null;
  }
}

