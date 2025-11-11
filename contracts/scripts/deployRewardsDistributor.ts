import hre from "hardhat";

const EMISSION_ENV = "NYRA_EMISSION_PER_SEC";

async function main() {
  const getNamedAccounts = (hre as unknown as { getNamedAccounts?: () => Promise<Record<string, string>> }).getNamedAccounts;
  const deployments = (hre as unknown as { deployments?: { deploy: (...args: any[]) => Promise<any>; getOrNull: (name: string) => Promise<{ address: string } | undefined> } }).deployments;
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;

  if (!getNamedAccounts || !deployments) {
    throw new Error("Hardhat-deploy is required (getNamedAccounts/deployments missing)");
  }
  if (!hardhatEthers) {
    throw new Error("hre.ethers is undefined – check Hardhat configuration");
  }

  const { deployer } = await getNamedAccounts();
  const { deploy, getOrNull } = deployments;

  console.log("===============================================");
  console.log("🚀 Deploying RewardsDistributor");
  console.log("👤 Deployer:", deployer);
  console.log("===============================================");

  const loanManagerDeployment = await getOrNull("LoanManager");
  if (!loanManagerDeployment) {
    throw new Error("LoanManager deployment not found. Deploy LoanManager first.");
  }

  const nyraDeployment = await getOrNull("NYRAToken");
  if (!nyraDeployment) {
    throw new Error("NYRAToken deployment not found. Deploy NYRA first.");
  }
  const nyraAddress = nyraDeployment.address;
  console.log(`ℹ️  Using NYRAToken at ${nyraAddress}`);

  const deployment = await deploy("RewardsDistributor", {
    from: deployer,
    contract: "RewardsDistributor",
    args: [nyraAddress, deployer, loanManagerDeployment.address],
    log: true,
    waitConfirmations: 2,
  });

  console.log("-----------------------------------------------");
  console.log("✅ RewardsDistributor deployed!");
  console.log("📍 Address:", deployment.address);
  console.log("🎯 Points manager (LoanManager):", loanManagerDeployment.address);
  console.log("-----------------------------------------------");

  const deployerSigner = await hardhatEthers.getSigner(deployer);
  const loanManager = await hardhatEthers.getContractAt("LoanManager", loanManagerDeployment.address, deployerSigner);

  console.log("🔗 Linking RewardsDistributor to LoanManager...");
  try {
    const tx = await loanManager.setRewardsDistributor(deployment.address);
    await tx.wait(1);
    console.log("✅ LoanManager updated.");
  } catch (error: any) {
    console.warn("⚠️  setRewardsDistributor reverted. LoanManager may already point to a distributor.");
    console.warn("   If needed, run this call manually after cleaning up.");
  }

  const emission = process.env[EMISSION_ENV];
  if (emission && emission.trim() !== "") {
    const emissionValue = BigInt(emission);
    console.log(`⚙️  Setting emissionPerSec = ${emissionValue.toString()}`);
    const rewardsDistributor = await hardhatEthers.getContractAt("RewardsDistributor", deployment.address, deployerSigner);
    const emissionTx = await rewardsDistributor.setEmissionPerSec(emissionValue);
    await emissionTx.wait(1);
    console.log("✅ Emission configured.");
  } else {
    console.warn(`⚠️  ${EMISSION_ENV} not set. Emission remains 0.`);
  }

  if (hre.network.name !== "hardhat" && process.env.ETHERSCAN_API_KEY) {
    try {
      console.log("🔍 Verifying contract on explorer...");
      await hre.run("verify:verify", {
        address: deployment.address,
        constructorArguments: [nyraAddress, deployer, loanManagerDeployment.address],
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

