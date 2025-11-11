import "dotenv/config";
import hre from "hardhat";
import { ethers } from "ethers";
import { promises as fs } from "fs";
import path from "path";

const deploymentsDir = path.resolve(__dirname, "..", "deployments", "arc");

type TokenConfig = {
  name: string;
  address: string;
  decimals: number;
  desiredDeposit: string;
};

async function loadDeploymentAddress(fileName: string): Promise<string> {
  const filePath = path.join(deploymentsDir, fileName);
  const content = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(content) as { address?: string };
  if (!data.address) {
    throw new Error(`Missing address field in ${filePath}`);
  }
  return data.address;
}

async function resolveAddress(envKey: string, deploymentFile?: string, staticAddress?: string): Promise<string> {
  const envValue = process.env[envKey];
  if (envValue && envValue.trim() !== "") {
    return envValue;
  }

  if (deploymentFile) {
    try {
      return await loadDeploymentAddress(deploymentFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Unable to read ${deploymentFile}: ${message}`);
    }
  }

  if (staticAddress) {
    console.log(`ℹ️  Using static address for ${envKey}: ${staticAddress}`);
    return staticAddress;
  }

  throw new Error(`Unable to resolve ${envKey}. Set env var or provide deployment file/static address.`);
}

async function ensureDeposit(
  hardhatEthers: any,
  user: any,
  cmAddr: string,
  token: TokenConfig,
  cm: ethers.Contract,
) {
  const signer = user;
  const tokenContract = await hardhatEthers.getContractAt("TestToken", token.address, signer);
  const desiredAmount = ethers.parseUnits(token.desiredDeposit, token.decimals);

  const currentBalance = await cm.collateralBalances(user.address, token.address);
  if (currentBalance >= desiredAmount) {
    console.log(`✅ Already have ${token.desiredDeposit} ${token.name} deposited.`);
    return;
  }

  const amountToDeposit = desiredAmount - currentBalance;
  const allowance = await tokenContract.allowance(user.address, cmAddr);
  if (allowance < amountToDeposit) {
    console.log(`🔑 Approving ${token.name}...`);
    await (await tokenContract.approve(cmAddr, amountToDeposit)).wait();
  }

  const userTokenBalance = await tokenContract.balanceOf(user.address);
  if (userTokenBalance < amountToDeposit) {
    throw new Error(
      `Insufficient ${token.name} balance. Need ${ethers.formatUnits(amountToDeposit, token.decimals)}, have ${ethers.formatUnits(userTokenBalance, token.decimals)}`,
    );
  }

  console.log(`📥 Depositing ${ethers.formatUnits(amountToDeposit, token.decimals)} ${token.name}...`);
  await (await cm.deposit(token.address, amountToDeposit)).wait();
}

async function main() {
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;
  if (!hardhatEthers) {
    throw new Error("Hardhat ethers plugin is not available. Ensure @nomicfoundation/hardhat-ethers is installed.");
  }

  const [user] = await hardhatEthers.getSigners();
  const cmAddr = await resolveAddress("COLLATERAL_MANAGER_ADDRESS", "CollateralManager.json");

  const tokens: TokenConfig[] = [
    {
      name: "BTC",
      address: await resolveAddress("BTC_ADDRESS", "BTC.json"),
      decimals: 8,
      desiredDeposit: "0.1",
    },
    {
      name: "ETH",
      address: await resolveAddress("ETH_ADDRESS", "ETH.json"),
      decimals: 18,
      desiredDeposit: "1",
    },
    {
      name: "BNB",
      address: await resolveAddress("BNB_ADDRESS", "BNB.json"),
      decimals: 18,
      desiredDeposit: "5",
    },
  ];

  const cm = await hardhatEthers.getContractAt("CollateralManager", cmAddr, user);
  console.log("👤 Using account:", user.address);

  for (const token of tokens) {
    await ensureDeposit(hardhatEthers, user, cmAddr, token, cm);
  }

  const [totalCollateralUSD, maxLoanUSD, debtUSD, healthFactor] = await cm.getUserCollateralData(user.address);
  console.log(`💰 Total collateral: ${Number(totalCollateralUSD) / 1e8} USD`);
  console.log(`💵 Max borrow allowed: ${Number(maxLoanUSD) / 1e8} USD`);
  console.log(`📉 Current debt: ${Number(debtUSD) / 1e8} USD`);
  console.log(`🛡️ Health factor: ${Number(healthFactor) / 1e18}`);

  for (const token of tokens) {
    const valueUSD = await cm.getCollateralValueUSDByToken(user.address, token.address);
    const config = await cm.tokenConfig(token.address);
    console.log(`🔍 ${token.name} collateral: ${Number(valueUSD) / 1e8} USD (LTV=${config.ltv}% / LT=${config.liquidationThreshold}%)`);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exitCode = 1;
});
