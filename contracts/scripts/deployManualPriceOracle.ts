import hre from "hardhat";

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const ARC_EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const INITIAL_PRICES = {
  EURC: 1.0,        // $1.00
  BTC: 98_000,      // $98,000
  ETH: 3_200,       // $3,200
  BNB: 420,         // $420
} as const;

function toOraclePrice(value: number): bigint {
  return BigInt(Math.round(value * 1e8));
}

async function main() {
  const getNamedAccounts = (hre as unknown as { getNamedAccounts?: () => Promise<Record<string, string>> }).getNamedAccounts;
  const deployments = (hre as unknown as { deployments?: { deploy: (...args: any[]) => Promise<any>; get: (...args: any[]) => Promise<any> } }).deployments;
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;

  if (!getNamedAccounts || !deployments || !hardhatEthers) {
    throw new Error("Hardhat-deploy or ethers not configured properly.");
  }

  const { deployer } = await getNamedAccounts();
  const { deploy, get } = deployments;

  console.log("===============================================");
  console.log("🚀 Deploying ManualPriceOracle with deployer:", deployer);
  console.log("===============================================");

  const btcDeployment = await get("BTC");
  const ethDeployment = await get("ETH");
  const bnbDeployment = await get("BNB");

  const deployResult = await deploy("ManualPriceOracle", {
    from: deployer,
    args: [ARC_USDC_ADDRESS, deployer],
    log: true,
  });

  console.log("📘 ManualPriceOracle deployed at:", deployResult.address);

  const signer = await hardhatEthers.getSigner(deployer);
  const oracle = await hardhatEthers.getContractAt("ManualPriceOracle", deployResult.address, signer);

  console.log("🔄 Setting initial prices...");
  const tokens = [ARC_EURC_ADDRESS, btcDeployment.address, ethDeployment.address, bnbDeployment.address];
  const prices = [
    toOraclePrice(INITIAL_PRICES.EURC),
    toOraclePrice(INITIAL_PRICES.BTC),
    toOraclePrice(INITIAL_PRICES.ETH),
    toOraclePrice(INITIAL_PRICES.BNB),
  ];

  await (await oracle.setPrices(tokens, prices)).wait();

  console.log("✅ Initial prices configured:");
  console.log(`   • EURC = $${INITIAL_PRICES.EURC.toFixed(2)}`);
  console.log(`   • BTC  = $${INITIAL_PRICES.BTC.toLocaleString()}`);
  console.log(`   • ETH  = $${INITIAL_PRICES.ETH.toLocaleString()}`);
  console.log(`   • BNB  = $${INITIAL_PRICES.BNB.toLocaleString()}`);
}

main().catch((err) => {
  console.error("❌ Deploy failed:", err);
  process.exitCode = 1;
});

