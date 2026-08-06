export function GameResult({ outcome, detail, onPlayAgain, waitingText = "", draw = false, neutral = false, className = "" }: {
  outcome: string;
  detail: string;
  onPlayAgain?: () => void;
  waitingText?: string;
  draw?: boolean;
  neutral?: boolean;
  className?: string;
}) {
  return <div className={`game-result-banner ${draw ? "is-draw" : ""} ${neutral ? "is-neutral" : ""} ${className}`.trim()} role="status" aria-live="assertive">
    <span className="game-result-seal" aria-hidden="true">{draw ? "引" : neutral ? "終" : "勝"}</span>
    <div className="game-result-copy"><small>{draw ? "MATCH DRAW" : neutral ? "ROUND COMPLETE" : "MATCH WINNER"}</small><h2>{outcome}</h2><p>{detail}</p></div>
    {onPlayAgain
      ? <button className="primary-button game-result-replay" onClick={onPlayAgain}><span>PLAY AGAIN</span><b>↻</b></button>
      : <div className="game-result-wait"><i />{waitingText}</div>}
  </div>;
}
