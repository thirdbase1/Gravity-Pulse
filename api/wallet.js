import { ethers } from "ethers";
import axios from "axios";

const GRAVITY_RPC =
  process.env.GRAVITY_RPC || "https://evmrpc-testnet.0g.ai";
const EXPLORER_API =
  process.env.EXPLORER_API ||
  "https://chainscan-galileo.0g.ai/v1/transaction";

const provider = new ethers.JsonRpcProvider(GRAVITY_RPC);

const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { address } = req.query;
    if (!address || !ethers.isAddress(address))
      return res.status(400).json({ error: "Invalid wallet address" });

    // ✅ Native balance
    const nativeBalance = await provider.getBalance(address);
    const formattedNative = ethers.formatEther(nativeBalance);

    // ✅ Fetch all transactions (only first 100 for speed)
    const limit = 100;
    const url = `${EXPLORER_API}?accountAddress=${address}&limit=${limit}&skip=0`;
    const { data } = await axios.get(url);

    // ✅ Correct structure from API
    const txList = data?.result?.list || [];
    const totalTx = data?.result?.total || txList.length;

    // ✅ Sort by oldest to newest
    const sortedTxs = [...txList].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    const firstTxDate = sortedTxs[0]
      ? new Date(sortedTxs[0].timestamp * 1000).toLocaleString()
      : "N/A";

    // ✅ Auto-detect token balances from recent transactions
    const tokenAddresses = [
      ...new Set(
        txList
          .map((tx) => tx.toTokenInfo?.address)
          .filter((addr) => ethers.isAddress(addr))
      ),
    ];

    const tokens = [];
    for (const tokenAddr of tokenAddresses) {
      try {
        const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
        const [name, symbol, decimals, balance] = await Promise.all([
          contract.name(),
          contract.symbol(),
          contract.decimals(),
          contract.balanceOf(address),
        ]);

        const formatted = Number(ethers.formatUnits(balance, decimals));
        if (formatted > 0)
          tokens.push({ name, symbol, balance: formatted.toFixed(4) });
      } catch {
        // skip invalid contracts
      }
    }

    res.status(200).json({
      network: "Gravity Network Testnet",
      address,
      rpc: GRAVITY_RPC,
      nativeBalance: formattedNative,
      totalTransactions: totalTx,
      firstTxDate,
      tokens,
      transactions: txList.slice(0, 10), // last 10 for preview
    });
  } catch (err) {
    console.error("Error fetching wallet data:", err);
    res.status(500).json({ error: "Error fetching wallet data" });
  }
}
