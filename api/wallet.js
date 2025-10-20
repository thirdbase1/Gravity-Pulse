import axios from "axios";

export default async function handler(req, res) {
  try {
    const { address } = req.query;
    if (!address)
      return res.status(400).json({ error: "Missing wallet address" });

    // Base API endpoint for Gravity Network Explorer
    const BASE_URL = "https://chainscan-galileo.0g.ai/v1";

    // 1️⃣ Fetch native balance
    const balanceRes = await axios.get(`${BASE_URL}/account?accountAddress=${address}`);
    const nativeBalance = balanceRes?.data?.result?.balance
      ? Number(balanceRes.data.result.balance) / 1e18
      : 0;

    // 2️⃣ Fetch transaction history (limit 100 per page)
    const txRes = await axios.get(
      `${BASE_URL}/transaction?accountAddress=${address}&limit=100&skip=0`
    );

    const txList = txRes?.data?.result?.list || [];
    const totalTransactions = txRes?.data?.result?.total || txList.length;
    const firstTx = txList.length
      ? txList[txList.length - 1]
      : null;
    const firstTxDate = firstTx
      ? new Date(firstTx.timestamp * 1000).toLocaleString()
      : "N/A";

    // Prepare compact recent transactions (latest 10)
    const txHistory = txList.slice(0, 10).map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      timestamp: tx.timestamp,
    }));

    // 3️⃣ Placeholder for tokens & NFTs (no API currently)
    const tokens = []; // Add ERC20 logic when available
    const nftHoldings = []; // Add NFT logic when API exists

    // 4️⃣ Response payload
    return res.status(200).json({
      address,
      network: "Gravity Network Testnet",
      nativeBalance,
      totalTransactions,
      firstTxDate,
      tokens,
      nftHoldings,
      txHistory,
    });
  } catch (error) {
    console.error("Error fetching wallet:", error.message);
    return res.status(500).json({ error: "Failed to fetch wallet data" });
  }
}
