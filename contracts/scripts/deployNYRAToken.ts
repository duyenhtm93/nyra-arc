import hre from "hardhat";

const TREASURY_ENV = "NYRA_TREASURY_ADDRESS";

async function main() {
  const getNamedAccounts = (hre as unknown as { getNamedAccounts?: () => Promise<Record<string, string>> }).getNamedAccounts;
  const deployments = (hre as unknown as { deployments?: { deploy: (...args: any[]) => Promise<any> } }).deployments;

  if (!getNamedAccounts) {
    throw new Error("hre.getNamedAccounts is undefined – ensure hardhat-deploy is configured");
  }

  if (!deployments) {
    throw new Error("hre.deployments is undefined – ensure hardhat-deploy is configured");
  }

  const { deployer } = await getNamedAccounts();
  const { deploy } = deployments;

  console.log("===============================================");
  console.log("🚀 Deploying NYRAToken");
  console.log("👤 Deployer:", deployer);
  console.log("===============================================");

  const configuredTreasury = process.env[TREASURY_ENV];
  const treasury = configuredTreasury && configuredTreasury.trim() !== "" ? configuredTreasury : deployer;

  if (!configuredTreasury) {
    console.warn(`⚠️  ${TREASURY_ENV} not set. Using deployer (${deployer}) as treasury.`);
  }

  const deployment = await deploy("NYRAToken", {
    from: deployer,
    contract: "NYRAToken",
    args: [treasury],
    log: true,
    waitConfirmations: 2,
  });

  console.log("-----------------------------------------------");
  console.log("✅ NYRAToken deployed!");
  console.log("📍 Address:", deployment.address);
  console.log("🏦 Treasury:", treasury);
  console.log("-----------------------------------------------");

  if (hre.network.name !== "hardhat" && process.env.ETHERSCAN_API_KEY) {
    try {
      console.log("🔍 Verifying contract on explorer...");
      await hre.run("verify:verify", {
        address: deployment.address,
        constructorArguments: [treasury],
      });
      console.log("🧾 Verified!");
    } catch (err: any) {
      console.warn("⚠️  Verification skipped:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  process.exitCode = 1;
});

