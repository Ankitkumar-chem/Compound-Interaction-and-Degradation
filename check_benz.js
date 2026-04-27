import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

const configPath = new URL("./firebase-applet-config.json", import.meta.url);
const configStr = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(configStr);

const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function check() {
  const allSnapshot = await getDocs(collection(db, "compounds"));
  let count = 0;
  allSnapshot.forEach((d) => {
    const data = d.data();
    if (data.name.toLowerCase().includes("benzgalantamine") || (data.smiles && data.smiles.includes("C5=CC=C"))) {
      console.log("ID:", d.id);
      console.log("Name:", data.name);
      console.log("SMILES:", data.smiles);
      console.log("---");
      count++;
    }
  });
  console.log("Total matching found:", count);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })
