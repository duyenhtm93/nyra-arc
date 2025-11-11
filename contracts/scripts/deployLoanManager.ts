import hre from "hardhat";
import { ethers } from "hardhat";

const COLLATERAL_MANAGER_DEPLOYMENT_NAME = "CollateralManager";

async function main() {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, getOrNull } = hre.deployments;

  console.log("===============================================");
  console.log("🚀 Deploying LoanManager contract");
  console.log("👤 Deployer:", deployer);
  console.log("===============================================");

  const collateralDeployment = await getOrNull(COLLATERAL_MANAGER_DEPLOYMENT_NAME);
  if (!collateralDeployment) {
    throw new Error(`CollateralManager not deployed on network '${hre.network.name}'. Deploy it first.`);
  }

  const collateralManagerAddr = collateralDeployment.address;

  console.log("🔗 Using CollateralManager at:", collateralManagerAddr);

  const deployed = await deploy("LoanManager", {
    from: deployer,
    contract: "LoanManager",
    args: [collateralManagerAddr, deployer],
    log: true,
    waitConfirmations: 2,
  });

  console.log("===============================================");
  console.log("✅ LoanManager deployed successfully!");
  console.log("-----------------------------------------------");
  console.log(`📍 LoanManager: ${deployed.address}`);
  console.log(`🧩 CollateralManager: ${collateralManagerAddr}`);
  console.log(`👑 Owner: ${deployer}`);
  console.log("-----------------------------------------------");

  if (hre.network.name !== "hardhat" && process.env.ETHERSCAN_API_KEY) {
    try {
      console.log("🔍 Verifying contract on explorer...");
      await hre.run("verify:verify", {
        address: deployed.address,
        constructorArguments: [collateralManagerAddr, deployer],
      });
      console.log("🧾 Verified!");
    } catch (err: any) {
      console.log("⚠️ Verification skipped:", err.message);
    }
  }
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  console.log("===============================================");
  process.exitCode = 1;
});
