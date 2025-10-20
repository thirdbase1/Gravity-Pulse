import axios from "axios";

export default async function handler(req, res) {
  try {
    const { address } = req.query;
    if (!address)
      return res.status(400).json({ error: "Missing wallet address" });

    const BASE_URL = "https://chainscan-galileo.0g.ai/v1";

    // 1️⃣ Fetch Account Info
    const accountRes = await axios.get(`${BASE_URL}/account?accountAddress=${address}`);
    const nativeBalance = accountRes?.data?.result?.balance
      ? Number(accountRes.data.result.balance) / 1e18
      : 0;

    // 2️⃣ Fetch All Tokens (ERC20 + Others)
    let tokenHoldings = [];
    try {
      const tokenRes = await axios.get(`${BASE_URL}/token?accountAddress=${address}&limit=100&skip=0`);
      if (tokenRes.data?.result?.list?.length > 0) {
        tokenHoldings = tokenRes.data.result.list.map((t) => ({
          name: t.tokenName || "Unknown",
          symbol: t.tokenSymbol || "",
          balance: t.balance ? Number(t.balance) / 10 ** (t.tokenDecimal || 18) : 0,
          address: t.tokenAddress,
        }));
      }
    } catch {
      tokenHoldings = [];
    }

    // 3️⃣ Fetch Transaction History
    const txRes = await axios.get(
      `${BASE_URL}/transaction?accountAddress=${address}&limit=100&skip=0`
    );
    const txList = txRes?.data?.result?.list || [];
    const totalTransactions = txRes?.data?.result?.total || txList.length;

    const firstTx = txList.length ? txList[txList.length - 1] : null;
    const firstTxDate = firstTx
      ? new Date(firstTx.timestamp * 1000).toLocaleString()
      : "N/A";

    // 4️⃣ Daily Activity Calculation
    const dailyActivity = {};
    txList.forEach((tx) => {
      const date = new Date(tx.timestamp * 1000)
        .toISOString()
        .split("T")[0];
      dailyActivity[date] = (dailyActivity[date] || 0) + 1;
    });

    const activityGraph = Object.entries(dailyActivity).map(([date, count]) => ({
      date,
      count,
    }));

    // 5️⃣ Response Payload
    res.status(200).json({
      address,
      network: "Gravity Network Testnet",
      nativeBalance,
      totalTransactions,
      firstTxDate,
      tokens: tokenHoldings,
      txHistory: txList.slice(0, 20).map((tx) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        timestamp: tx.timestamp,
      })),
      activityGraph,
    });
  } catch (error) {
    console.error("Error fetching wallet data:", error.message);
    res.status(500).json({ error: "Failed to fetch wallet data" });
  }
}
