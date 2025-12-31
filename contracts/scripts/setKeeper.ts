import hre from "hardhat";

async function main() {
    const hardhatEthers = (hre as any).ethers;
    const deployments = (hre as any).deployments;

    // The keeper address from your log
    const KEEPER_ADDRESS = "0x638a0E1469A0f6001f07586F509Adbd783F3E045";

    const { deployer } = await hre.getNamedAccounts();
    const signer = await hardhatEthers.getSigner(deployer);

    const oracleDeployment = await deployments.get("ManualPriceOracle");
    const oracle = await hardhatEthers.getContractAt("ManualPriceOracle", oracleDeployment.address, signer);

    console.log(`Setting keeper status for ${KEEPER_ADDRESS} on Oracle at ${oracleDeployment.address}...`);

    const tx = await oracle.setKeeper(KEEPER_ADDRESS, true);
    await tx.wait();

    console.log("✅ Keeper authorized successfully!");
}

main().catch((err) => {
    console.error("❌ Setup failed:", err);
    process.exitCode = 1;
});
