"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HeaderChatButton } from "./chat-chrome";
import { GameResult } from "./game-result";
import { blackjackHandValue, blackjackPayout, createBlackjackShoe, dealerShouldHit, isNaturalBlackjack, settleBlackjack, shuffleBlackjackShoe, type BlackjackCard, type BlackjackOutcome } from "./blackjack-logic";

type RoundPhase = "betting" | "player" | "dealer" | "settled";
const CHIP_VALUES = [25, 50, 100, 250];
const SUIT_MARKS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
const OUTCOME_COPY: Record<BlackjackOutcome, { title: string; detail: string }> = {
  blackjack: { title: "Blackjack!", detail: "Natural 21 pays 3 to 2." },
  win: { title: "You Win!", detail: "Your hand beats the dealer." },
  lose: { title: "Dealer Wins", detail: "The house takes this hand." },
  push: { title: "Push", detail: "Your wager has been returned." },
};

function PlayingCard({ card, hidden = false, index = 0 }: { card: BlackjackCard; hidden?: boolean; index?: number }) {
  if (hidden) return <span className="blackjack-card is-hidden" style={{ "--deal-index": index } as CSSProperties} aria-label="Dealer hole card"><i>庭</i></span>;
  const red = card.suit === "diamonds" || card.suit === "hearts";
  return <span className={`blackjack-card ${red ? "is-red" : ""}`} style={{ "--deal-index": index } as CSSProperties} aria-label={`${card.rank} of ${card.suit}`}><b>{card.rank}<small>{SUIT_MARKS[card.suit]}</small></b><i>{SUIT_MARKS[card.suit]}</i><em>{card.rank}<small>{SUIT_MARKS[card.suit]}</small></em></span>;
}

export function Blackjack({ onBack, onScore }: { onBack: () => void; onScore: (score: number) => void }) {
  const shoe = useRef<BlackjackCard[]>(shuffleBlackjackShoe(createBlackjackShoe()));
  const dealerTimer = useRef<number | null>(null);
  const [bankroll, setBankroll] = useState(1000);
  const [selectedBet, setSelectedBet] = useState(50);
  const [wager, setWager] = useState(0);
  const [player, setPlayer] = useState<BlackjackCard[]>([]);
  const [dealer, setDealer] = useState<BlackjackCard[]>([]);
  const [phase, setPhase] = useState<RoundPhase>("betting");
  const [outcome, setOutcome] = useState<BlackjackOutcome | null>(null);
  const [round, setRound] = useState(0);

  const draw = useCallback(() => {
    if (shoe.current.length < 60) shoe.current = shuffleBlackjackShoe(createBlackjackShoe());
    return shoe.current.pop()!;
  }, []);

  const playerValue = useMemo(() => blackjackHandValue(player), [player]);
  const dealerValue = useMemo(() => blackjackHandValue(dealer), [dealer]);

  const finishRound = useCallback((finalPlayer: BlackjackCard[], finalDealer: BlackjackCard[], finalWager: number, availableBankroll: number) => {
    const result = settleBlackjack(finalPlayer, finalDealer);
    const endingBankroll = availableBankroll + blackjackPayout(result, finalWager);
    setPlayer(finalPlayer);
    setDealer(finalDealer);
    setBankroll(endingBankroll);
    setOutcome(result);
    setPhase("settled");
    onScore(Math.max(1, Math.floor(endingBankroll)));
  }, [onScore]);

  const playDealer = useCallback((finalPlayer: BlackjackCard[], startingDealer: BlackjackCard[], finalWager: number, availableBankroll: number) => {
    setPhase("dealer");
    dealerTimer.current = window.setTimeout(() => {
      const finalDealer = [...startingDealer];
      while (dealerShouldHit(finalDealer)) finalDealer.push(draw());
      finishRound(finalPlayer, finalDealer, finalWager, availableBankroll);
    }, 620);
  }, [draw, finishRound]);

  const deal = () => {
    if (selectedBet > bankroll || selectedBet < 1) return;
    const nextPlayer = [draw(), draw()];
    const nextDealer = [draw(), draw()];
    const available = bankroll - selectedBet;
    setRound((current) => current + 1);
    setBankroll(available);
    setWager(selectedBet);
    setPlayer(nextPlayer);
    setDealer(nextDealer);
    setOutcome(null);
    if (isNaturalBlackjack(nextPlayer) || isNaturalBlackjack(nextDealer)) playDealer(nextPlayer, nextDealer, selectedBet, available);
    else setPhase("player");
  };

  const hit = () => {
    if (phase !== "player") return;
    const nextPlayer = [...player, draw()];
    setPlayer(nextPlayer);
    const total = blackjackHandValue(nextPlayer).total;
    if (total > 21) finishRound(nextPlayer, dealer, wager, bankroll);
    else if (total === 21) playDealer(nextPlayer, dealer, wager, bankroll);
  };

  const stand = () => { if (phase === "player") playDealer(player, dealer, wager, bankroll); };
  const doubleDown = () => {
    if (phase !== "player" || player.length !== 2 || bankroll < wager) return;
    const doubledWager = wager * 2;
    const available = bankroll - wager;
    const nextPlayer = [...player, draw()];
    setBankroll(available);
    setWager(doubledWager);
    setPlayer(nextPlayer);
    if (blackjackHandValue(nextPlayer).total > 21) finishRound(nextPlayer, dealer, doubledWager, available);
    else playDealer(nextPlayer, dealer, doubledWager, available);
  };

  const nextRound = () => {
    setPlayer([]); setDealer([]); setWager(0); setOutcome(null); setPhase("betting");
    setSelectedBet((current) => Math.min(current, bankroll || 50));
  };
  const resetBankroll = () => {
    if (dealerTimer.current != null) window.clearTimeout(dealerTimer.current);
    shoe.current = shuffleBlackjackShoe(createBlackjackShoe());
    setBankroll(1000); setSelectedBet(50); setWager(0); setPlayer([]); setDealer([]); setOutcome(null); setPhase("betting"); setRound(0);
  };

  useEffect(() => () => { if (dealerTimer.current != null) window.clearTimeout(dealerTimer.current); }, []);

  const dealerShownTotal = phase === "player" ? blackjackHandValue(dealer.slice(0, 1)).total : dealerValue.total;
  const canDouble = phase === "player" && player.length === 2 && bankroll >= wager;
  const resultCopy = outcome ? OUTCOME_COPY[outcome] : null;
  const tableBet = wager || selectedBet;
  const tableChipColor = tableBet >= 250 ? "gold" : tableBet >= 100 ? "red" : tableBet >= 50 ? "blue" : "black";

  return <main className="game-shell blackjack-shell">
    <header className="game-topbar"><button className="back-button" onClick={onBack}>← Game menu</button><span className="header-title-logo game-header-logo" role="img" aria-label="Game Garden" /><div className="game-header-actions"><HeaderChatButton inGame /><button className="icon-button" onClick={resetBankroll} aria-label="Reset blackjack table">↻</button></div></header>
    <section className="blackjack-game">
      <div className="blackjack-heading"><div><p className="eyebrow">CASINO · SOLO TABLE</p><h1>Blackjack</h1><p>Beat the dealer without going over 21.</p></div><span className="blackjack-heading-mark" aria-hidden="true"><i>A<small>♠</small></i><b>K<small>♥</small></b></span></div>
      <div className="blackjack-bank"><div><small>BANKROLL</small><strong>{bankroll.toLocaleString()}<em> CHIPS</em></strong></div><b>BET <span>{wager || selectedBet}</span></b><div><small>ROUND</small><strong>{round || "—"}</strong></div></div>
      <div className="blackjack-table">
        <div className="blackjack-felt-mark" aria-hidden="true"><span>BLACKJACK</span><small>PAYS 3 TO 2 · DEALER STANDS ON 17</small></div>
        <div key={`${phase}-${tableBet}`} className={`blackjack-table-wager chip-${tableChipColor}`} aria-label={`${tableBet} chips wagered`}><small>YOUR BET</small><span /><span /><span><b>{tableBet}</b></span></div>
        <section className="blackjack-hand dealer-hand"><div><small>DEALER</small><strong>{dealer.length ? dealerShownTotal : "—"}</strong></div><div className="blackjack-cards">{dealer.map((card, index) => <PlayingCard key={card.id} card={card} hidden={index === 1 && phase === "player"} index={index} />)}</div></section>
        <div className="blackjack-status" role="status">{phase === "betting" ? "PLACE YOUR BET" : phase === "player" ? playerValue.total > 21 ? "BUST" : "YOUR MOVE" : phase === "dealer" ? "DEALER PLAYING" : resultCopy?.title.toUpperCase()}</div>
        <section className="blackjack-hand player-hand"><div><small>PLAYER</small><strong>{player.length ? playerValue.total : "—"}{playerValue.soft && player.length ? <em> SOFT</em> : null}</strong></div><div className="blackjack-cards">{player.map((card, index) => <PlayingCard key={card.id} card={card} index={index + 2} />)}</div></section>
      </div>
      {phase === "betting" && bankroll > 0 && <div className="blackjack-betting"><div><small>SELECT BET</small><span>Play chips only</span></div><div className="blackjack-chips">{CHIP_VALUES.filter((value) => value <= bankroll).map((value) => <button key={value} className={selectedBet === value ? "active" : ""} onClick={() => setSelectedBet(value)} aria-label={`Bet ${value} chips`}><span>{value}</span></button>)}</div><button className="primary-button blackjack-deal" onClick={deal}>DEAL <span>→</span></button></div>}
      {phase === "player" && <div className="blackjack-actions"><button onClick={hit}><span>＋</span><b>HIT</b><small>Take a card</small></button><button className="stand" onClick={stand}><span>■</span><b>STAND</b><small>Hold your hand</small></button><button onClick={doubleDown} disabled={!canDouble}><span>×2</span><b>DOUBLE</b><small>One final card</small></button></div>}
      {phase === "dealer" && <div className="blackjack-dealer-thinking"><i /><span>Dealer reveals the hole card…</span></div>}
      {phase === "settled" && resultCopy && <div className="blackjack-result"><GameResult outcome={resultCopy.title} detail={`${resultCopy.detail} Bankroll: ${bankroll.toLocaleString()} chips.`} onPlayAgain={bankroll >= 25 ? nextRound : resetBankroll} draw={outcome === "push"} neutral={outcome === "lose"} /></div>}
    </section>
  </main>;
}
