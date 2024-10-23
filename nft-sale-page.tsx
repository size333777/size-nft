"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { useUmi } from "./useMetaplex";
import {
  publicKey,
  transactionBuilder,
  generateSigner,
} from "@metaplex-foundation/umi";
import {
  fetchCandyMachine,
  mintV2,
  fetchCandyGuard,
  CandyGuard,
} from "@metaplex-foundation/mpl-candy-machine";
import { setComputeUnitLimit as setCULToolbox } from "@metaplex-foundation/mpl-toolbox";
import Stars from "./app-stars";
import Aurora from "./Aurora";
import Image from "next/image";
import logo from "@/size-logo.png";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
// Add these imports
import { useToast } from "@/hooks/use-toast";
import confetti from "canvas-confetti";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

interface CandyMachine {
  itemsRedeemed: bigint;
  data: {
    itemsAvailable: bigint;
  };
  publicKey: { toString: () => string };
  // Comment out unused property
  // items: Array<{ name: string; uri: string; minted: boolean }>;
}

// Custom serializer function to handle BigInt
const customStringify = (obj: unknown): string => {
  return JSON.stringify(obj, (key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
};

export default function NFTSalePage() {
  const wallet = useWallet();
  const { umi } = useUmi();
  const [candyMachine, setCandyMachine] = useState<CandyMachine | null>(null);
  const [candyGuard, setCandyGuard] = useState<CandyGuard | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  // const [mintedNFTs, setMintedNFTs] = useState<
  //   Array<{ name: string; mintAddress: string }>
  // >([]);
  const [mintAmount, setMintAmount] = useState(1);
  const [network, setNetwork] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  // Add this line to use the toast hook
  const { toast } = useToast();
  // Add these state variables
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const { connection } = useConnection();

  useEffect(() => {
    if (!umi) return;

    setIsLoading(true);
    // Replace with your actual Candy Machine ID
    const candyMachineId = publicKey(
      "2dRJBxx8PnBHTfBgfF5daVkSu19HG1JzspzxfcvRufy9"
    );

    fetchCandyMachine(umi, candyMachineId)
      .then((cm) => {
        console.log("[NFTSalePage] Candy Machine loaded:", customStringify(cm));
        setCandyMachine(cm);
        return fetchCandyGuard(umi, cm.mintAuthority);
      })
      .then((cg) => {
        console.log("[NFTSalePage] Candy Guard loaded:", customStringify(cg));
        setCandyGuard(cg);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error(
          "[NFTSalePage] Error loading Candy Machine or Guard:",
          error
        );
        setIsLoading(false);
      });

    // Determine the network
    setNetwork(umi.rpc.getEndpoint().includes("devnet") ? "Devnet" : "Mainnet");
  }, [umi]);

  // Add this useEffect to fetch the user's balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (wallet.publicKey) {
        try {
          const balance = await connection.getBalance(wallet.publicKey);
          setBalance(balance / LAMPORTS_PER_SOL);
        } catch (error) {
          console.error("[NFTSalePage] Error fetching balance:", error);
          setError("Failed to fetch wallet balance");
        }
      }
    };

    fetchBalance();
    // Set up an interval to refresh the balance every 30 seconds
    const intervalId = setInterval(fetchBalance, 30000);

    return () => clearInterval(intervalId);
  }, [wallet.publicKey, connection]);

  const handleMint = async () => {
    if (!candyMachine || !candyGuard || !wallet.publicKey) return;

    setIsMinting(true);
    setError(null);
    try {
      // Check if user has enough balance
      const price = getPrice();
      if (price && balance !== null) {
        const totalCost = parseFloat(price.toString()) * mintAmount;
        if (balance < totalCost) {
          throw new Error(
            `Insufficient balance. You need at least ${totalCost} SOL to mint.`
          );
        }
      }

      const nftMints = Array(mintAmount)
        .fill(null)
        .map(() => generateSigner(umi));

      console.log(
        "[NFTSalePage] Candy Machine:",
        customStringify(candyMachine)
      );
      console.log("[NFTSalePage] Candy Guard:", customStringify(candyGuard));

      let tx = transactionBuilder();

      for (let i = 0; i < mintAmount; i++) {
        const mintArgs = {
          candyMachine: candyMachine.publicKey,
          nftMint: nftMints[i],
          // @ts-expect-error: Type 'PublicKey' is not assignable to type 'Pda'.
          collectionMint: candyMachine.collectionMint,
          // @ts-expect-error: Type 'PublicKey' is not assignable to type 'Pda'.
          collectionUpdateAuthority: candyMachine.authority,
          // @ts-expect-error: Type 'PublicKey' is not assignable to type 'Pda'.
          tokenStandard: candyMachine.tokenStandard,
          // @ts-expect-error: Type 'PublicKey' is not assignable to type 'Pda'.
          candyGuard: candyMachine.mintAuthority,
          mintArgs: {},
        };

        if (candyGuard.guards && candyGuard.guards.solPayment) {
          mintArgs.mintArgs = {
            solPayment: {
              // @ts-expect-error: Type thing placeholder
              destination: candyGuard.guards.solPayment.value.destination,
            },
          };
        }

        console.log(
          `[NFTSalePage] Mint Arguments for NFT ${i + 1}:`,
          customStringify(mintArgs)
        );

        // @ts-expect-error: Type 'PublicKey' is not assignable to type 'Pda'.
        tx = tx.add(mintV2(umi, mintArgs));
      }

      // Add compute unit limit instruction at the beginning of the transaction
      tx = transactionBuilder()
        .add(setCULToolbox(umi, { units: 800_000 * mintAmount }))
        .add(tx);

      const result = await tx.sendAndConfirm(umi, {
        confirm: { commitment: "confirmed" },
      });

      console.log("[NFTSalePage] Transaction result:", result);

      // Update mintedNFTs with more information
      // const newMintedNFTs = nftMints.map((nftMint, index) => ({
      //   // @ts-expect-error: Type thing placeholder
      //   name: `SIZE NFT #${Number(candyMachine.itemsMinted) + index + 1}`,
      //   mintAddress: nftMint.publicKey.toString(),
      // }));

      // setMintedNFTs((prev) => [...prev, ...newMintedNFTs]);

      // Show success toast and trigger confetti
      toast({
        title: "Minting Successful!",
        description: `You've successfully minted ${mintAmount} NFT${
          mintAmount > 1 ? "s" : ""
        }.`,
        variant: "default",
      });

      // Trigger confetti
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });

      // After successful minting, fetch user NFTs
      // @ts-expect-error: Type thing placeholder
      await fetchUserNFTs(wallet.publicKey);
    } catch (error) {
      console.error("[NFTSalePage] Error minting NFTs:", error);
      if (error instanceof Error) {
        console.error("[NFTSalePage] Error message:", error.message);
        console.error("[NFTSalePage] Error stack:", error.stack);
        setError(error.message);
      } else {
        setError("An unknown error occurred while minting");
      }

      // Show error toast
      toast({
        title: "Minting Failed",
        description:
          error instanceof Error
            ? error.message
            : "There was an error while minting your NFT. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  // Modify the getPrice function to return a number
  const getPrice = (): number | null => {
    console.log("[NFTSalePage] Getting price");
    if (!candyGuard) return null;

    if (candyGuard.guards && candyGuard.guards.solPayment) {
      const solPayment = candyGuard.guards.solPayment;
      console.log("[NFTSalePage] Sol Payment guard:", solPayment);
      return (
        // @ts-expect-error: Type thing placeholder
        parseInt(solPayment.value.lamports.basisPoints.toString()) /
        LAMPORTS_PER_SOL
      );
    }
    return null;
  };

  // Add this function to check if the user can mint
  const canMint = (): boolean => {
    const price = getPrice();
    if (price === null || balance === null) return false;
    return balance >= price * mintAmount;
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-4 relative">
      <div className="bg-gradient-to-t from-[rgb(219,140,167)] via-[rgb(127,49,238)] to-[rgb(115,97,243)] absolute inset-0"></div>
      <Aurora />
      <Stars />

      <div className="z-10 w-full max-w-4xl">
        <header className="mb-8 flex justify-between items-center">
          <Link href="/">
            <Image
              src={logo}
              alt="Size Logo"
              width={100}
              height={100}
              className="cursor-pointer"
            />
          </Link>
          <div className="flex flex-col items-end">
            <WalletMultiButton />
          </div>
        </header>

        {network === "Devnet" && (
          <p className="text-purple-100 mt-2 text-center">
            Current Network: {network}
          </p>
        )}

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl shadow-lg mb-8">
          <h2 className="text-2xl font-semibold text-white mb-4">
            NFTs Minted
          </h2>
          {isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="w-full">
              <div className="bg-white/20 rounded-full h-8 mb-2 overflow-hidden">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-500 ease-in-out"
                  style={{
                    width:
                      candyMachine &&
                      candyMachine.data &&
                      candyMachine.itemsRedeemed !== undefined
                        ? `${
                            (Number(candyMachine.itemsRedeemed) /
                              Number(candyMachine.data.itemsAvailable)) *
                            100
                          }%`
                        : "0%",
                  }}
                />
              </div>
              <div className="text-center text-white text-sm font-semibold">
                {candyMachine &&
                candyMachine.data &&
                candyMachine.itemsRedeemed !== undefined
                  ? `${candyMachine.itemsRedeemed.toString()} / ${candyMachine.data.itemsAvailable.toString()}`
                  : "0 / 0"}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl shadow-lg mb-8">
          <h2 className="text-2xl font-semibold text-white mb-4">Mint NFTs</h2>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : wallet.connected && candyMachine && candyGuard ? (
            <div className="flex flex-col items-center space-y-4">
              <div className="flex items-center justify-between w-full">
                <span className="text-white">Quantity:</span>
                <div className="flex items-center bg-white/20 rounded-lg">
                  <button
                    onClick={() => setMintAmount(Math.max(1, mintAmount - 1))}
                    className="px-3 py-2 text-white hover:bg-white/30 rounded-l-lg transition-colors"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={
                      Number(candyMachine.data.itemsAvailable) -
                      Number(candyMachine.itemsRedeemed)
                    }
                    value={mintAmount}
                    onChange={(e) =>
                      setMintAmount(
                        Math.min(
                          Math.max(1, parseInt(e.target.value) || 1),
                          Number(candyMachine.data.itemsAvailable) -
                            Number(candyMachine.itemsRedeemed)
                        )
                      )
                    }
                    className="w-12 bg-transparent text-white text-center"
                  />
                  <button
                    onClick={() =>
                      setMintAmount(
                        Math.min(
                          mintAmount + 1,
                          Number(candyMachine.data.itemsAvailable) -
                            Number(candyMachine.itemsRedeemed)
                        )
                      )
                    }
                    className="px-3 py-2 text-white hover:bg-white/30 rounded-r-lg transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between w-full">
                <span className="text-white">Price:</span>
                <span className="text-white font-bold">
                  {getPrice() || "N/A"} SOL
                </span>
              </div>
              {balance !== null && (
                <div className="flex items-center justify-between w-full">
                  <span className="text-white">Your Balance:</span>
                  <span className="text-white font-bold">
                    {balance.toFixed(4)} SOL
                  </span>
                </div>
              )}
              <Button
                onClick={handleMint}
                disabled={isMinting || !canMint()}
                className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 w-full text-lg font-semibold relative"
              >
                {isMinting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                    Minting...
                  </>
                ) : (
                  `Mint ${mintAmount} NFT${mintAmount > 1 ? "s" : ""}`
                )}
              </Button>
              {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            </div>
          ) : (
            <p className="text-center text-purple-100">
              Connect your wallet to mint NFTs
            </p>
          )}
        </div>

        {/* {mintedNFTs.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl shadow-lg">
            <h2 className="text-2xl font-semibold text-white mb-4">
              Recently Minted NFTs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {mintedNFTs.map((nft, index) => (
                <div
                  key={index}
                  className="bg-white/20 p-4 rounded-lg text-center"
                >
                  <p className="text-purple-100 font-semibold mb-2">
                    {nft.name}
                  </p>
                  <p className="text-purple-100 text-sm mb-2">
                    Mint Address: {truncateAddress(nft.mintAddress)}
                  </p>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(nft.mintAddress)
                    }
                    className="bg-purple-600 hover:bg-purple-700 text-white text-sm py-1 px-2 rounded"
                  >
                    Copy Address
                  </button>
                </div>
              ))}
            </div>
          </div>
        )} */}
      </div>
    </main>
  );
}

