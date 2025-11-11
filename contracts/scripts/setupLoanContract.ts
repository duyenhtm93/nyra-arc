import hre from "hardhat";
import { formatUnits, parseUnits } from "ethers";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

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

  console.log("===============================================");
  console.log("🔧 Setting up LoanManager with deployer:", deployer.address);
  console.log("===============================================");

  const loanManagerDeployment = await get("LoanManager");
  const oracleDeployment = await get("ManualPriceOracle");
  const nyraDeployment = await get("NYRAToken").catch(() => null);

  const loanManagerAddr = loanManagerDeployment.address;
  const oracleAddr = oracleDeployment.address;
  const usdcAddr = USDC_ADDRESS;
  const eurcAddr = EURC_ADDRESS;
  const nyraAddr = nyraDeployment ? nyraDeployment.address : undefined;

  const loanManager = await hardhatEthers.getContractAt("LoanManager", loanManagerAddr, deployer);
  const usdc = await hardhatEthers.getContractAt("IERC20", usdcAddr, deployer);
  const eurc = await hardhatEthers.getContractAt("IERC20", eurcAddr, deployer);

  console.log("📘 LoanManager:", loanManagerAddr);
  console.log("📘 ManualPriceOracle:", oracleAddr);
  console.log("📘 Lending tokens:");
  console.log("   • USDC:", usdcAddr);
  console.log("   • EURC:", eurcAddr);
  if (nyraAddr) {
    console.log("📘 NYRA token:", nyraAddr);
  }
  console.log("-----------------------------------------------");

  // 0️⃣ Set price oracle if needed
  const currentOracle = await loanManager.priceOracle();
  if (currentOracle.toLowerCase() !== oracleAddr.toLowerCase()) {
    console.log("🔮 Setting ManualPriceOracle...");
    await (await loanManager.setPriceOracle(oracleAddr)).wait();
    console.log("✅ PriceOracle set!");
  } else {
    console.log("ℹ️  PriceOracle already configured.");
  }

  // 1️⃣ Configure interest rates
  const configureToken = async (
    token: string,
    borrowRateBps: number,
    lendRateBps: number,
    label: string,
  ) => {
    console.log(`⚙️  Configuring ${label} rates...`);
    await (await loanManager.supportToken(token, borrowRateBps, lendRateBps)).wait();
    console.log(
      `✅ ${label} supported (Borrow=${(borrowRateBps / 100).toFixed(2)}%, Lend=${(lendRateBps / 100).toFixed(2)}%)`,
    );
  };

  await configureToken(usdcAddr, 700, 400, "USDC");
  await configureToken(eurcAddr, 650, 350, "EURC");

  // 2️⃣ Optional: set legacy reward token (if NYRA deployed)
  if (nyraAddr) {
    const currentReward = await loanManager.rewardToken();
    if (currentReward.toLowerCase() !== nyraAddr.toLowerCase()) {
      console.log("🏆 Setting reward token = NYRA (legacy) ...");
      await (await loanManager.setRewardToken(nyraAddr)).wait();
      console.log("✅ Reward token set!");
    } else {
      console.log("ℹ️  Reward token already configured.");
    }
  } else {
    console.log("ℹ️  NYRAToken not deployed yet. Skipping reward token setup.");
  }

  // 3️⃣ Seed liquidity for quick testing
  console.log("-----------------------------------------------");
  console.log("💰 Funding LoanManager with initial liquidity (USDC & EURC)...");

  const amountUSDC = parseUnits("10", 6);
  const amountEURC = parseUnits("10", 6);

  const usdcBal = await usdc.balanceOf(deployer.address);
  if (usdcBal >= amountUSDC) {
    await (await usdc.transfer(loanManagerAddr, amountUSDC)).wait();
    console.log("✅ Funded 10 USDC");
  } else {
    console.warn("⚠️  Skipped funding USDC – deployer balance too low.");
  }

  const eurcBal = await eurc.balanceOf(deployer.address);
  if (eurcBal >= amountEURC) {
    await (await eurc.transfer(loanManagerAddr, amountEURC)).wait();
    console.log("✅ Funded 10 EURC");
  } else {
    console.warn("⚠️  Skipped funding EURC – deployer balance too low.");
  }

  // 4️⃣ Treasury overview
  console.log("-----------------------------------------------");
  console.log("📊 Checking treasury balances...");

  const usdcTreasury = await loanManager.treasury(usdcAddr);
  const eurcTreasury = await loanManager.treasury(eurcAddr);

  console.log(
    `   • USDC: deposits=${formatUnits(usdcTreasury.totalDeposits, 6)} | borrows=${formatUnits(
      usdcTreasury.totalBorrows,
      6,
    )} | repayments=${formatUnits(usdcTreasury.totalRepayments, 6)}`,
  );
  console.log(
    `   • EURC: deposits=${formatUnits(eurcTreasury.totalDeposits, 6)} | borrows=${formatUnits(
      eurcTreasury.totalBorrows,
      6,
    )} | repayments=${formatUnits(eurcTreasury.totalRepayments, 6)}`,
  );
  console.log("-----------------------------------------------");

  console.log("✅ LoanManager setup completed successfully!");
  console.log("===============================================");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exitCode = 1;
});
