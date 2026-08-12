export type BlackjackSuit = "clubs" | "diamonds" | "hearts" | "spades";
export type BlackjackRank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type BlackjackCard = { id: string; suit: BlackjackSuit; rank: BlackjackRank };
export type BlackjackOutcome = "blackjack" | "win" | "lose" | "push";

const SUITS: BlackjackSuit[] = ["clubs", "diamonds", "hearts", "spades"];
const RANKS: BlackjackRank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function createBlackjackShoe(decks = 6) {
  const cards: BlackjackCard[] = [];
  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ id: `${deck}-${suit}-${rank}`, suit, rank });
  }
  return cards;
}

export function shuffleBlackjackShoe(cards: BlackjackCard[], random = Math.random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function blackjackHandValue(cards: BlackjackCard[]) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") { total += 11; aces += 1; }
    else if (card.rank === "K" || card.rank === "Q" || card.rank === "J") total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
}

export function isNaturalBlackjack(cards: BlackjackCard[]) {
  return cards.length === 2 && blackjackHandValue(cards).total === 21;
}

export function dealerShouldHit(cards: BlackjackCard[]) {
  return blackjackHandValue(cards).total < 17;
}

export function settleBlackjack(player: BlackjackCard[], dealer: BlackjackCard[]): BlackjackOutcome {
  const playerValue = blackjackHandValue(player).total;
  const dealerValue = blackjackHandValue(dealer).total;
  const playerNatural = isNaturalBlackjack(player);
  const dealerNatural = isNaturalBlackjack(dealer);
  if (playerValue > 21) return "lose";
  if (playerNatural && !dealerNatural) return "blackjack";
  if (dealerNatural && !playerNatural) return "lose";
  if (playerNatural && dealerNatural) return "push";
  if (dealerValue > 21 || playerValue > dealerValue) return "win";
  if (playerValue < dealerValue) return "lose";
  return "push";
}

export function blackjackPayout(outcome: BlackjackOutcome, wager: number) {
  if (outcome === "blackjack") return wager * 2.5;
  if (outcome === "win") return wager * 2;
  if (outcome === "push") return wager;
  return 0;
}
