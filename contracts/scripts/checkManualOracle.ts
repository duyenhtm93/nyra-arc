import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import hre from "hardhat";
import { ethers } from "ethers";

const manualOracleAbi = ["function getPrice(address token) view returns (uint256)"];
const deploymentsDir = path.resolve(__dirname, "..", "deployments", "arc");

type TokenConfig = {
  name: string;
  address: string;
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

type ResolveAddressConfig = {
  envKey: string;
  deploymentFile?: string;
  staticAddress?: string;
};

async function resolveAddress({ envKey, deploymentFile, staticAddress }: ResolveAddressConfig): Promise<string> {
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

  throw new Error(`Unable to resolve ${envKey}: set env var or ensure deployment file exists.`);
}

async function main() {
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;
  if (!hardhatEthers) {
    throw new Error("Hardhat ethers plugin is not available. Ensure @nomicfoundation/hardhat-ethers is installed.");
  }

  const manualOracleAddress = await resolveAddress({
    envKey: "MANUAL_ORACLE_ADDRESS",
    deploymentFile: "ManualPriceOracle.json",
  });

  const tokens: TokenConfig[] = [
    {
      name: "EURC",
      address: await resolveAddress({
        envKey: "EURC_ADDRESS",
        staticAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      }),
    },
    {
      name: "BTC",
      address: await resolveAddress({
        envKey: "BTC_ADDRESS",
        deploymentFile: "BTC.json",
      }),
    },
    {
      name: "ETH",
      address: await resolveAddress({
        envKey: "ETH_ADDRESS",
        deploymentFile: "ETH.json",
      }),
    },
    {
      name: "BNB",
      address: await resolveAddress({
        envKey: "BNB_ADDRESS",
        deploymentFile: "BNB.json",
      }),
    },
  ];

  const [signer] = await hardhatEthers.getSigners();
  console.log("👤 Reading oracle prices with account:", signer.address);

  const provider =
    signer.provider ??
    hardhatEthers.provider ??
    new ethers.JsonRpcProvider(
      process.env.ARC_RPC_URL?.trim() ||
        ((hre.network.config as { url?: string }).url ??
          (() => {
            throw new Error("RPC URL not found. Set ARC_RPC_URL or configure network URL in Hardhat.");
          })()),
    );
  if (!provider) {
    throw new Error("Provider not available. Ensure Hardhat network 'arc' is configured correctly.");
  }
  const oracle = new ethers.Contract(manualOracleAddress, manualOracleAbi, provider);

  for (const token of tokens) {
    try {
      const rawPrice: bigint = await oracle.getPrice(token.address);
      const price = Number(rawPrice) / 1e8;
      console.log(`💰 ${token.name}/USD = ${price.toFixed(4)} USD`);
    } catch (error) {
      console.error(`❌ Failed to fetch price for ${token.name}:`, error);
    }
  }
}

main().catch((error) => {
  console.error("❌ checkManualOracle failed:", error);
  process.exitCode = 1;
});



