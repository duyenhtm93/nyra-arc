import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config";

// Load secrets from .env
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const ARC_RPC_URL = "https://rpc.testnet.arc.network";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: PRIVATE_KEY
        ? [
            {
              privateKey: `0x${PRIVATE_KEY}`,
              balance: "10000000000000000000000", // 10,000 ETH
            },
          ]
        : [],
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
    },
    arc: {
      url: ARC_RPC_URL,
      chainId: 5042002,
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
    },
  },
  solidity: {
    version: "0.8.24",
    settings: {
      metadata: {
        bytecodeHash: "none", // disable ipfs
        useLiteralContent: true, // use source code
      },
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  sourcify: undefined,
  etherscan: {
    enabled: false,
  },
};

export default config;

