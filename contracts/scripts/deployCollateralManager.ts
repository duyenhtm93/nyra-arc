import hre from "hardhat";
import { ethers } from "hardhat";

const MANUAL_ORACLE_DEPLOYMENT_NAME = "ManualPriceOracle";

async function main() {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, getOrNull } = hre.deployments;

  console.log("🚀 Deploying CollateralManager with account:", deployer);

  const manualOracleDeployment = await getOrNull(MANUAL_ORACLE_DEPLOYMENT_NAME);
  if (!manualOracleDeployment) {
    throw new Error(`ManualPriceOracle not deployed on network '${hre.network.name}'. Deploy it first.`);
  }

  const oracleAddress = manualOracleDeployment.address;
  const loanManagerAddress = ethers.ZeroAddress;

  console.log("📋 Deployment parameters:");
  console.log(`   Oracle: ${oracleAddress}`);
  console.log(`   LoanManager: ${loanManagerAddress}`);
  console.log(`   Owner: ${deployer}`);

  console.log("⏳ Deploying CollateralManager...");
  const deployed = await deploy("CollateralManager", {
    from: deployer,
    contract: "CollateralManager",
    args: [oracleAddress, loanManagerAddress, deployer],
    log: true,
    waitConfirmations: 2,
  });

  console.log("✅ CollateralManager deployed successfully!");
  console.log("--------------------------------------------");
  console.log(`📍 CollateralManager: ${deployed.address}`);
  console.log(`🔗 Oracle:  ${oracleAddress}`);
  console.log(`🧩 LoanMgr: ${loanManagerAddress}`);
  console.log(`👤 Owner:   ${deployer}`);
  console.log("--------------------------------------------");

  if (hre.network.name !== "hardhat" && process.env.ETHERSCAN_API_KEY) {
    try {
      console.log("🔍 Verifying contract on explorer...");
      await hre.run("verify:verify", {
        address: deployed.address,
        constructorArguments: [oracleAddress, loanManagerAddress, deployer],
      });
      console.log("🧾 Verified!");
    } catch (err: any) {
      console.log("⚠️ Verification skipped:", err.message);
    }
  }
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});
