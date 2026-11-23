const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("--> Déploiement de UrbanIssueRegistry en cours...");
  console.log("Compte déployeur (Admin + Municipalité) :", deployer.address);

  const UrbanIssueRegistry = await hre.ethers.getContractFactory("UrbanIssueRegistry");
  const registry = await UrbanIssueRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("=================================================");
  console.log(" UrbanIssueRegistry déployé avec succès !");
  console.log(" Adresse :", address);
  console.log("=================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});