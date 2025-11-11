import hre from "hardhat";

async function main() {
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;
  const deployments = (hre as unknown as { deployments?: { get: (...args: any[]) => Promise<any> } }).deployments;

  if (!hardhatEthers) {
    throw new Error("hre.ethers is undefined – check Hardhat configuration");
  }

  if (!deployments) {
    throw new Error("hre.deployments is undefined – ensure hardhat-deploy is configured");
  }

  const [deployer] = await hardhatEthers.getSigners();
  const { get } = deployments;

  const cmDeployment = await get("CollateralManager");
  const loanManagerDeployment = await get("LoanManager");
  const btcDeployment = await get("BTC");
  const ethDeployment = await get("ETH");
  const bnbDeployment = await get("BNB");

  const cmAddr = cmDeployment.address;
  const loanManagerAddr = loanManagerDeployment.address;
  const btc = btcDeployment.address;
  const eth = ethDeployment.address;
  const bnb = bnbDeployment.address;

  console.log("⚙️ Setup CollateralManager with deployer:", deployer.address);

  const cm = await hardhatEthers.getContractAt("CollateralManager", cmAddr, deployer);

  // ✅ 1️⃣ Link LoanManager if needed
  const currentLoanManager = await cm.loanManager();
  if (currentLoanManager.toLowerCase() !== loanManagerAddr.toLowerCase()) {
    const tx = await cm.setLoanManager(loanManagerAddr);
    await tx.wait();
    console.log("✅ LoanManager linked:", loanManagerAddr);
  } else {
    console.log("ℹ️  LoanManager already linked:", loanManagerAddr);
  }

  // ✅ 2️⃣ Update liquidation params (close factor & bonus)
  const CLOSE_FACTOR_BPS = 5_000; // 50%
  const LIQUIDATION_BONUS_BPS = 600; // 6%
  const currentCloseFactor = await cm.closeFactorBps();
  const currentBonus = await cm.liquidationBonusBps();
  if (currentCloseFactor !== CLOSE_FACTOR_BPS || currentBonus !== LIQUIDATION_BONUS_BPS) {
    await (await cm.setLiquidationParams(CLOSE_FACTOR_BPS, LIQUIDATION_BONUS_BPS)).wait();
    console.log(`✅ Liquidation params set (closeFactor=${CLOSE_FACTOR_BPS / 100}%, bonus=${LIQUIDATION_BONUS_BPS / 100}% )`);
  } else {
    console.log("ℹ️  Liquidation params already configured");
  }

  // helper to add/update collateral configs
  const configureToken = async (token: string, ltv: number, threshold: number, label: string) => {
    const config = await cm.tokenConfig(token);
    if (!config.allowed) {
      await (await cm.addAllowedToken(token, ltv, threshold)).wait();
      console.log(`✅ ${label} added (LTV=${ltv}%, Threshold=${threshold}%)`);
    } else {
      await (await cm.updateTokenLTV(token, ltv, threshold)).wait();
      console.log(`✅ ${label} updated (LTV=${ltv}%, Threshold=${threshold}%)`);
    }
  };

  await configureToken(btc, 75, 82, "BTC");
  await configureToken(eth, 72, 80, "ETH");
  await configureToken(bnb, 65, 75, "BNB");

  console.log("🎉 CollateralManager setup completed successfully!");
}

main().catch((err) => {
  console.error("❌ Setup failed:", err);
  process.exitCode = 1;
});
