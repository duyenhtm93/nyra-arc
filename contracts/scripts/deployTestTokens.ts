import hre from "hardhat";

async function main() {
  const getNamedAccounts = (hre as unknown as { getNamedAccounts?: () => Promise<Record<string, string>> }).getNamedAccounts;
  const deployments = (hre as unknown as { deployments?: { deploy: (...args: any[]) => Promise<any> } }).deployments;
  const hardhatEthers = (hre as unknown as { ethers?: any }).ethers;

  if (!getNamedAccounts) {
    throw new Error("hre.getNamedAccounts is undefined – ensure hardhat-deploy is configured");
  }

  if (!deployments) {
    throw new Error("hre.deployments is undefined – ensure hardhat-deploy is configured");
  }

  if (!hardhatEthers) {
    throw new Error("hre.ethers is undefined – check Hardhat configuration");
  }

  const { deployer } = await getNamedAccounts();
  const { deploy } = deployments;

  console.log("Deploying collateral tokens with:", deployer);

  // BTC: 8 decimals, owner receives 1 BTC
  const btcDeployment = await deploy("BTC", {
    from: deployer,
    contract: "TestToken",
    args: ["Wrapped Bitcoin", "BTC", 8, deployer, hardhatEthers.parseUnits("1", 8)],
    log: true,
  });

  // ETH: 18 decimals, owner receives 10 ETH
  const ethDeployment = await deploy("ETH", {
    from: deployer,
    contract: "TestToken",
    args: ["Wrapped Ether", "ETH", 18, deployer, hardhatEthers.parseUnits("10", 18)],
    log: true,
  });

  // BNB: 18 decimals, owner receives 10 BNB
  const bnbDeployment = await deploy("BNB", {
    from: deployer,
    contract: "TestToken",
    args: ["Wrapped BNB", "BNB", 18, deployer, hardhatEthers.parseUnits("10", 18)],
    log: true,
  });

  // Configure faucet amounts (one-time claim per user)
  const deployerSigner = await hardhatEthers.getSigner(deployer);
  const btcContract = await hardhatEthers.getContractAt("TestToken", btcDeployment.address, deployerSigner);
  const ethContract = await hardhatEthers.getContractAt("TestToken", ethDeployment.address, deployerSigner);
  const bnbContract = await hardhatEthers.getContractAt("TestToken", bnbDeployment.address, deployerSigner);

  await (await btcContract.setFaucetAmount(hardhatEthers.parseUnits("0.1", 8))).wait();
  await (await ethContract.setFaucetAmount(hardhatEthers.parseUnits("1", 18))).wait();
  await (await bnbContract.setFaucetAmount(hardhatEthers.parseUnits("1", 18))).wait();

  console.log("✅ BTC:", btcDeployment.address, "faucet 0.1 BTC");
  console.log("✅ ETH:", ethDeployment.address, "faucet 1 ETH");
  console.log("✅ BNB:", bnbDeployment.address, "faucet 1 BNB");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

