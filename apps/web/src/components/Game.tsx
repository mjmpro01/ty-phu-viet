"use client";
import { useEffect, useRef, useState } from "react";
import { BOARD, CARDS } from "@tpv/shared";
import type { PublicState, Tile, TradeSide } from "@tpv/shared";
import { useGame, money } from "../lib/store";
import vi from "../i18n/vi.json";
import en from "../i18n/en.json";
const colors = [
  "#e85545",
  "#2485c7",
  "#e6ac22",
  "#8666c7",
  "#249c81",
  "#dc66a3",
];
const symbols: Record<string, string> = {
  GO: "↗",
  JAIL: "▥",
  PARKING: "P",
  GO_TO_JAIL: "→",
  CHANCE: "?",
  FORTUNE: "★",
  AIRPORT: "✈",
  UTILITY: "◈",
  TAX: "₫",
};
function coords(i: number) {
  if (i <= 10) return { row: 11, col: 11 - i };
  if (i <= 20) return { row: 21 - i, col: 1 };
  if (i <= 30) return { row: 1, col: i - 19 };
  return { row: i - 29, col: 11 };
}
const errors: Record<string, string> = {
  INVALID_STATE: "Hành động không phù hợp lúc này.",
  NOT_YOUR_TURN: "Chưa đến lượt của bạn.",
  INSUFFICIENT_CASH: "Bạn chưa đủ tiền.",
  NOT_READY: "Cần 2–6 người chơi đều sẵn sàng.",
  GROUP_REQUIRED: "Cần sở hữu cả nhóm và chuộc mọi ô cầm cố.",
  BUILD_EVENLY: "Hãy xây đều các đất trong nhóm.",
  SELL_EVENLY: "Hãy bán nhà ở ô có cấp cao nhất trước.",
  MORTGAGE_BLOCKED: "Phải bán hết nhà trong nhóm trước khi cầm cố.",
  BANK_SUPPLY: "Ngân hàng không còn đủ nhà hoặc khách sạn.",
  BID_TOO_LOW: "Giá đặt phải cao hơn ít nhất 100.000đ.",
  TRADE_ALREADY_OPEN: "Hãy hoàn tất hoặc hủy giao dịch đang mở.",
  STALE_TURN: "Lượt đã đổi. Hãy thử lại.",
  TURN_EXPIRED: "Đã hết thời gian lượt.",
  MATCH_EXPIRED: "Ván đấu đã hết thời gian.",
  CAN_PAY_DEBT: "Bạn vẫn có thể thanh lý tài sản để trả nợ.",
  RATE_LIMITED: "Bạn thao tác hơi nhanh. Hãy đợi một chút.",
  DISCONNECTED: "Chưa kết nối được với máy chủ.",
  RECOVERING: "Máy chủ đang khôi phục kết nối.",
  REQUEST_TIMEOUT: "Chưa nhận được phản hồi. Hãy kiểm tra kết nối.",
  ROOM_NOT_FOUND: "Không tìm thấy phòng.",
  ROOM_UNAVAILABLE: "Phòng đã bắt đầu hoặc đủ 6 người.",
  BOT_CONTROL:
    "Bot đang hoàn tất lượt. Bạn sẽ nhận lại quyền ở lượt tiếp theo.",
  SPECTATOR_FORBIDDEN: "Khán giả chỉ có thể xem ván đấu.",
  TRADE_CLOSED: "Giao dịch đã kết thúc hoặc hết hạn.",
  DEBT_PENDING: "Bạn cần giải quyết khoản nợ trước.",
  NOT_IN_ROOM: "Bạn chưa ở trong phòng.",
  INVALID_PAYLOAD: "Thông tin gửi lên chưa hợp lệ.",
  NOT_OWNER: "Bạn không sở hữu tài sản này.",
  NOT_ELIGIBLE: "Bạn không thể tham gia đấu giá này.",
  AUCTION_CLOSED: "Đấu giá đã kết thúc.",
  SEAT_NOT_FOUND: "Không tìm thấy ghế chơi của phiên này.",
};
function Board({
  state,
  selected,
  onSelect,
  children,
}: {
  state: PublicState | null;
  selected: string | null;
  onSelect: (t: Tile) => void;
  children: React.ReactNode;
}) {
  const [positions, setPositions] = useState<Record<string, number>>({});
  const phase = state?.turn?.phase,
    turnId = state?.turn?.id,
    path = state?.turn?.path.join(",");
  useEffect(() => {
    if (!state) return;
    const next = Object.fromEntries(
      Object.values(state.players).map((p) => [p.id, p.position]),
    );
    setPositions(next);
    if (phase !== "MOVING") return;
    const current = state.turn!;
    const timers = current.path.map((pos, i) =>
      setTimeout(
        () => setPositions((p) => ({ ...p, [current.playerId]: pos })),
        (i + 1) * state.rules.stepMs,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, turnId, path, state?.version]);
  return (
    <div className="board-frame">
      <div className="board">
        {BOARD.map((t) => {
          const c = coords(t.position),
            property = state?.properties[t.id];
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className={`tile ${selected === t.id ? "selected" : ""} ${[0, 10, 20, 30].includes(t.position) ? "corner" : ""}`}
              style={
                {
                  gridRow: c.row,
                  gridColumn: c.col,
                  "--tile-color": t.color,
                } as React.CSSProperties
              }
              title={`${t.name}${t.price ? " · " + money(t.price) : ""}`}
              aria-label={`${t.name}${property?.ownerId ? " · " + state?.players[property.ownerId]?.name : ""}`}
            >
              {t.kind === "LAND" && <span className="color-band" />}
              <span className="tile-symbol">{symbols[t.kind] || ""}</span>
              <span className="tile-name">{t.name}</span>
              {t.price && (
                <span className="tile-price">{t.price / 1000000}tr</span>
              )}
              {property?.ownerId && (
                <span
                  className="owner-mark"
                  style={{
                    background: colors[state!.order.indexOf(property.ownerId)],
                  }}
                />
              )}
              {property && property.level > 0 && (
                <span className="building-badge">
                  {property.level === 5 ? "KS" : `${property.level}⌂`}
                </span>
              )}
              {property?.mortgaged && <span className="mortgage-mark">C</span>}
            </button>
          );
        })}
        <div className="board-center">{children}</div>
        {state?.order.map((id, i) => {
          const p = state.players[id];
          if (p.status === "BANKRUPT") return null;
          const c = coords(positions[id] ?? p.position);
          return (
            <span
              key={id}
              className="token"
              title={p.name}
              style={{
                background: colors[i],
                left: `${((c.col - 0.5) * 100) / 11 + ((i % 3) - 1) * 1.6}%`,
                top: `${((c.row - 0.5) * 100) / 11 + (Math.floor(i / 3) - 0.5) * 2.2}%`,
              }}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Đóng">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function eventText(e: PublicState["events"][number], s: PublicState) {
  const name = e.playerId ? s.players[e.playerId]?.name : "";
  switch (e.kind) {
    case "START":
      return "Ván đấu bắt đầu. Chúc bạn may mắn!";
    case "DICE":
      return `${name} tung ${(e.data.dice as number[]).join(" + ")}`;
    case "BUY":
      return `${name} mua ${BOARD[Number(e.data.tileId)].name} · ${money(Number(e.data.price))}`;
    case "PAYMENT":
      return `${name} trả ${money(Number(e.data.amount))}${e.data.creditorId ? " cho " + s.players[String(e.data.creditorId)]?.name : " cho ngân hàng"}`;
    case "MOVED":
      return `${name} đến ${BOARD[Number(e.data.position)].name}`;
    case "CARD":
      return `${name}: ${e.data.text}`;
    case "JAIL":
      return `${name} vào tù`;
    case "BOT_TAKEOVER":
      return `Bot tiếp quản lượt của ${name}`;
    case "BANKRUPTCY":
      return `${name} đã phá sản`;
    case "AUCTION_END":
      return e.data.bidderId
        ? `${s.players[String(e.data.bidderId)]?.name} thắng đấu giá · ${money(Number(e.data.highestBid))}`
        : "Đấu giá kết thúc, không có người mua";
    default:
      return `${name} · ${e.kind}`;
  }
}
export default function Game({ initialCode = "" }: { initialCode?: string }) {
  const {
    state,
    userId,
    role,
    connected,
    error,
    busy,
    rooms,
    chat,
    offset,
    connect,
    send,
    clearError,
  } = useGame();
  const [lang, setLang] = useState<"vi" | "en">("vi"),
    [name, setName] = useState(""),
    [roomCode, setRoomCode] = useState(initialCode),
    [visibility, setVisibility] = useState("PUBLIC"),
    [tab, setTab] = useState("players"),
    [selected, setSelected] = useState<Tile | null>(null),
    [tradeOpen, setTradeOpen] = useState(false),
    [chatText, setChatText] = useState(""),
    [bidAmount, setBidAmount] = useState(100000),
    [now, setNow] = useState(Date.now()),
    [startingMoney, setStartingMoney] = useState(15000000),
    [seconds, setSeconds] = useState(45),
    [auctions, setAuctions] = useState(true),
    [mode, setMode] = useState("LAST_STANDING"),
    [minutes, setMinutes] = useState(60),
    [copied, setCopied] = useState(false);
  const [to, setTo] = useState(""),
    [giveCash, setGiveCash] = useState(0),
    [takeCash, setTakeCash] = useState(0),
    [giveTiles, setGiveTiles] = useState<string[]>([]),
    [takeTiles, setTakeTiles] = useState<string[]>([]),
    [giveCards, setGiveCards] = useState<string[]>([]),
    [takeCards, setTakeCards] = useState<string[]>([]);
  const t = lang === "vi" ? vi : en;
  useEffect(() => {
    connect();
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [connect]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (state?.status === "LOBBY") {
      setStartingMoney(state.rules.startingMoney);
      setSeconds(state.rules.turnDurationMs / 1000);
      setAuctions(state.rules.auctionsEnabled);
      setMode(state.rules.mode);
      setMinutes(state.rules.durationMs / 60000);
    }
  }, [state?.rules]);
  const me = state?.players[userId],
    turn = state?.turn,
    current = turn ? state?.players[turn.playerId] : null,
    myTurn =
      turn?.playerId === userId &&
      role === "PLAYER" &&
      me?.controller === "HUMAN",
    manage = myTurn && turn?.phase === "ACTION" && turn.pending === "MANAGE",
    hasDebt = myTurn && turn?.pending === "DEBT",
    remaining = turn
      ? Math.max(
          0,
          Math.ceil(
            ((turn.auction?.deadlineAt ?? turn.deadlineAt) - now - offset) /
              1000,
          ),
        )
      : 0,
    auction = turn?.auction,
    openTrades = Object.values(state?.trades || {}).filter(
      (x) => x.status === "OPEN",
    );
  const disabled = !connected || busy;
  const roomRules = {
    startingMoney,
    auctionsEnabled: auctions,
    turnDurationMs: seconds * 1000,
    mode,
    durationMs: minutes * 60000,
  };
  function create() {
    if (!name.trim()) return;
    send({
      type: "CREATE_ROOM",
      name: name.trim(),
      visibility,
      rules: roomRules,
    });
  }
  function join(watch = false, code = roomCode) {
    if (!name.trim()) return;
    send({
      type: "JOIN_ROOM",
      code: code.trim().toUpperCase(),
      name: name.trim(),
      role: watch ? "SPECTATOR" : "PLAYER",
    });
  }
  function selectTile(tile: Tile) {
    setSelected(tile);
  }
  function toggle(list: string[], set: (x: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }
  const options = (
    <div className="rules-grid">
      <label>
        Vốn khởi điểm
        <input
          type="number"
          min={1000000}
          max={100000000}
          step={1000000}
          value={startingMoney}
          onChange={(e) => setStartingMoney(Number(e.target.value))}
        />
      </label>
      <label>
        Giây / lượt
        <input
          type="number"
          min={15}
          max={180}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
        />
      </label>
      <label>
        Chế độ
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="LAST_STANDING">Người cuối cùng</option>
          <option value="TIMED">Giới hạn thời gian</option>
        </select>
      </label>
      {mode === "TIMED" && (
        <label>
          Số phút
          <input
            type="number"
            min={5}
            max={240}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={auctions}
          onChange={(e) => setAuctions(e.target.checked)}
        />{" "}
        Bật đấu giá
      </label>
    </div>
  );
  return (
    <main className="app-shell">
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-icon">₫</span>
          <span>
            TỶ PHÚ <b>VIỆT</b>
            <small>ĐI MỘT VÒNG. MỞ CẢ CƠ HỘI.</small>
          </span>
        </a>
        <div className="top-actions">
          <span className={`connection ${connected ? "online" : ""}`}>
            {connected ? t.connected : t.reconnecting}
          </span>
          <button
            className="language"
            onClick={() => setLang(lang === "vi" ? "en" : "vi")}
          >
            {lang.toUpperCase()} / {lang === "vi" ? "EN" : "VI"}
          </button>
          {state && (
            <button
              className="subtle"
              onClick={() => {
                if (
                  window.confirm(
                    "Rời phòng? Ghế của bạn sẽ được bot tiếp quản sau 90 giây.",
                  )
                )
                  send({ type: "LEAVE_ROOM" });
              }}
            >
              {t.leave}
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="notice" role="alert">
          <span>{errors[error] || error}</span>
          <button onClick={clearError} aria-label="Đóng">
            ×
          </button>
        </div>
      )}
      <div className="game-heading">
        <div>
          <span className="eyebrow">
            {state
              ? `${role === "SPECTATOR" ? t.spectator : "PHÒNG CHƠI"} · ${state.code}`
              : "CHƠI CÙNG NHAU"}
          </span>
          <h1>
            {state?.status === "PLAYING"
              ? myTurn
                ? t.yourTurn
                : `Lượt của ${current?.name}`
              : state?.status === "FINISHED"
                ? t.result
                : state
                  ? "Chờ bạn bè vào phòng"
                  : "Một vòng Việt Nam"}
          </h1>
        </div>
        {state ? (
          <button
            className="room-code"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/room/${state.code}`,
                );
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Đã sao chép" : `${state.code} ⧉`}
          </button>
        ) : (
          <span className="pill">2–6 người · Online</span>
        )}
      </div>
      <div className="game-layout">
        <section className="play-area" aria-label="Bàn cờ">
          <Board
            state={state}
            selected={selected?.id || null}
            onSelect={selectTile}
          >
            {!state ? (
              <>
                <span className="center-kicker">HÀNH TRÌNH CỦA BẠN</span>
                <div className="board-title">
                  TỶ PHÚ
                  <br />
                  <span>VIỆT</span>
                </div>
                <p>
                  Mua đất. Xây nhà.
                  <br />
                  Cùng bạn bè làm nên cơ nghiệp.
                </p>
                <div className="route-chips">
                  <span>Hà Nội</span>
                  <span>Đà Nẵng</span>
                  <span>TP.HCM</span>
                </div>
                <div className="center-rule" />
                <small>Chọn tên và tạo phòng để bắt đầu</small>
              </>
            ) : state.status === "LOBBY" ? (
              <>
                <span className="center-kicker">HẸN NHAU TRÊN BÀN CỜ</span>
                <div className="board-title">
                  {state.order.length}
                  <span className="out-of"> / 6</span>
                </div>
                <p>Chia sẻ mã phòng với bạn bè</p>
                <strong className="large-code">{state.code}</strong>
                <small>
                  {state.order.filter((id) => state.players[id].ready).length}{" "}
                  người sẵn sàng
                </small>
              </>
            ) : state.status === "FINISHED" ? (
              <>
                <span className="center-kicker">CHÚC MỪNG</span>
                <div className="winner-star">★</div>
                <h2>
                  {state.result
                    ?.filter((x) => x.rank === 1)
                    .map((x) => state.players[x.playerId].name)
                    .join(" & ")}
                </h2>
                <p>Đã trở thành Tỷ Phú Việt</p>
                <strong>{money(state.result?.[0]?.assets || 0)}</strong>
              </>
            ) : (
              <>
                <div className="turn-label">
                  <span
                    style={{
                      background: colors[state.order.indexOf(turn!.playerId)],
                    }}
                  />
                  {current?.name}
                </div>
                <div
                  className={`dice-pair ${turn?.phase === "ROLLING" ? "rolling" : ""}`}
                  aria-label={`Xúc xắc ${turn?.dice?.join(" và ") || "chưa tung"}`}
                >
                  {(turn?.dice || [1, 1]).map((d, i) => (
                    <div className="die" key={i}>
                      {["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][d]}
                    </div>
                  ))}
                </div>
                <span className="phase-label">
                  {turn?.phase === "ROLLING"
                    ? "Đang tung xúc xắc"
                    : turn?.phase === "MOVING"
                      ? "Đang di chuyển"
                      : turn?.phase === "RESOLVING_TILE"
                        ? "Đang xử lý ô"
                        : turn?.phase === "WAITING"
                          ? "Sẵn sàng lên đường"
                          : turn?.phase === "END_TURN"
                            ? "Chuyển lượt"
                            : auction
                              ? t.auction
                              : hasDebt
                                ? t.debt
                                : "Quyết định của bạn"}
                </span>
                <div className={`timer ${remaining < 10 ? "urgent" : ""}`}>
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:
                  {String(remaining % 60).padStart(2, "0")}
                </div>
                {state.matchEndsAt && (
                  <small>
                    Ván còn{" "}
                    {Math.max(
                      0,
                      Math.ceil((state.matchEndsAt - now - offset) / 60000),
                    )}{" "}
                    phút
                  </small>
                )}
                {myTurn && turn?.phase === "WAITING" && (
                  <button
                    className="primary roll-btn"
                    disabled={disabled}
                    onClick={() => send({ type: "ROLL_DICE" })}
                  >
                    ⚄ {t.roll}
                  </button>
                )}
              </>
            )}
          </Board>
          <div className="board-footer">
            <span>
              <i className="legend-dot" /> Chạm vào ô để xem chi tiết
            </span>
            <span>40 ô · 8 vùng đất</span>
          </div>
          {state?.status === "PLAYING" && (
            <div className="action-bar">
              {role === "SPECTATOR" ? (
                <span>Bạn đang xem ván đấu trực tiếp</span>
              ) : (
                <>
                  {myTurn && turn?.phase === "WAITING" && (
                    <>
                      <button
                        className="primary mobile-roll"
                        disabled={disabled}
                        onClick={() => send({ type: "ROLL_DICE" })}
                      >
                        {t.roll}
                      </button>
                      {me?.jail !== null && (
                        <>
                          <button
                            disabled={
                              disabled || me!.cash < state.rules.jailFine
                            }
                            onClick={() => send({ type: "PAY_JAIL_FINE" })}
                          >
                            {lang === "vi" ? "Trả" : "Pay"}{" "}
                            {money(state.rules.jailFine)}{" "}
                            {lang === "vi" ? "ra tù" : "bail"}
                          </button>
                          {me?.cards.map((id) => (
                            <button
                              key={id}
                              disabled={disabled}
                              onClick={() =>
                                send({ type: "USE_JAIL_CARD", cardId: id })
                              }
                            >
                              {t.useCard}
                            </button>
                          ))}
                        </>
                      )}
                    </>
                  )}
                  {myTurn &&
                    turn?.phase === "ACTION" &&
                    turn.pending === "PURCHASE" && (
                      <>
                        <span>
                          <b>{BOARD[me!.position].name}</b> ·{" "}
                          {money(BOARD[me!.position].price!)}
                        </span>
                        <button
                          className="primary"
                          disabled={
                            disabled || me!.cash < BOARD[me!.position].price!
                          }
                          onClick={() =>
                            send({ type: "BUY", tileId: String(me!.position) })
                          }
                        >
                          {t.buy}
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            send({
                              type: "DECLINE_BUY",
                              tileId: String(me!.position),
                            })
                          }
                        >
                          {t.decline}
                        </button>
                      </>
                    )}
                  {auction && (
                    <>
                      <span>
                        <b>
                          {t.auction}: {BOARD[Number(auction.tileId)].name}
                        </b>
                        <small>
                          Giá cao nhất: {money(auction.highestBid)}{" "}
                          {auction.bidderId
                            ? `· ${state.players[auction.bidderId].name}`
                            : ""}
                        </small>
                      </span>
                      {auction.eligible.includes(userId) &&
                        !auction.passed.includes(userId) && (
                          <>
                            <input
                              aria-label="Giá đấu"
                              type="number"
                              step={state.rules.minBid}
                              min={auction.highestBid + state.rules.minBid}
                              value={Math.max(
                                bidAmount,
                                auction.highestBid + state.rules.minBid,
                              )}
                              onChange={(e) =>
                                setBidAmount(Number(e.target.value))
                              }
                            />
                            <button
                              className="primary"
                              disabled={disabled}
                              onClick={() =>
                                send({
                                  type: "AUCTION_BID",
                                  auctionId: auction.id,
                                  amount: Math.max(
                                    bidAmount,
                                    auction.highestBid + state.rules.minBid,
                                  ),
                                })
                              }
                            >
                              {t.bid}
                            </button>
                            <button
                              disabled={disabled || auction.bidderId === userId}
                              onClick={() =>
                                send({
                                  type: "AUCTION_PASS",
                                  auctionId: auction.id,
                                })
                              }
                            >
                              {t.pass}
                            </button>
                          </>
                        )}
                    </>
                  )}
                  {hasDebt && (
                    <>
                      <span>
                        <b>
                          {t.debt}: {money(turn!.debt!.amount)}
                        </b>
                        <small>
                          Bán nhà hoặc cầm cố tài sản nếu thiếu tiền.
                        </small>
                      </span>
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => send({ type: "SETTLE_DEBT" })}
                      >
                        {t.pay}
                      </button>
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (
                            confirm(
                              "Khai phá sản? Server sẽ kiểm tra khả năng trả nợ trước.",
                            )
                          )
                            send({ type: "DECLARE_BANKRUPTCY" });
                        }}
                      >
                        {t.bankrupt}
                      </button>
                    </>
                  )}
                  {manage && (
                    <>
                      <button
                        onClick={() => {
                          setTo(
                            state.order.find(
                              (id) =>
                                id !== userId &&
                                state.players[id].status === "ACTIVE",
                            ) || "",
                          );
                          setTradeOpen(true);
                        }}
                        disabled={disabled}
                      >
                        {t.trade}
                      </button>
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => send({ type: "END_TURN" })}
                      >
                        {t.end}
                      </button>
                    </>
                  )}
                  {!myTurn && !auction && (
                    <span>
                      {current?.name} đang chơi. Bạn có thể xem tài sản và trò
                      chuyện.
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </section>
        <aside className="sidebar">
          {!state ? (
            <section className="panel lobby-panel">
              <div className="panel-title">
                <span className="step-number">01</span>
                <h2>Vào bàn thôi!</h2>
              </div>
              <label>
                {t.name}
                <input
                  value={name}
                  maxLength={24}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Tuấn"
                  autoComplete="nickname"
                />
              </label>
              <div className="segmented">
                <button
                  className={visibility === "PUBLIC" ? "active" : ""}
                  onClick={() => setVisibility("PUBLIC")}
                >
                  {t.public}
                </button>
                <button
                  className={visibility === "PRIVATE" ? "active" : ""}
                  onClick={() => setVisibility("PRIVATE")}
                >
                  {t.private}
                </button>
              </div>
              <details>
                <summary>Tùy chỉnh luật chơi</summary>
                {options}
              </details>
              <button
                className="primary full"
                disabled={disabled || !name.trim()}
                onClick={create}
              >
                {t.create} <span>＋</span>
              </button>
              <div className="divider">
                <span>hoặc vào phòng của bạn bè</span>
              </div>
              <label>
                {t.code}
                <input
                  className="code-input"
                  value={roomCode}
                  maxLength={6}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="ABC234"
                />
              </label>
              <div className="button-row">
                <button
                  disabled={disabled || roomCode.length !== 6 || !name.trim()}
                  onClick={() => join()}
                >
                  {t.join}
                </button>
                <button
                  disabled={disabled || roomCode.length !== 6 || !name.trim()}
                  onClick={() => join(true)}
                >
                  {t.watch}
                </button>
              </div>
              <div className="rooms-head">
                <h3>Phòng công khai</h3>
                <button
                  className="subtle"
                  disabled={!connected}
                  onClick={() => send({ type: "LIST_ROOMS" })}
                >
                  Làm mới
                </button>
              </div>
              {rooms.length ? (
                rooms.map((r) => (
                  <div className="public-room" key={r.code}>
                    <span>
                      <b>{r.code}</b>
                      <small>
                        {r.host} · {r.players}/6 người
                      </small>
                    </span>
                    <button
                      disabled={disabled || !name.trim()}
                      onClick={() => join(r.status !== "LOBBY", r.code)}
                    >
                      {r.status === "LOBBY" ? t.join : t.watch}
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty">Chưa có phòng nào. Hãy mở bàn đầu tiên.</p>
              )}
            </section>
          ) : (
            <>
              <section className="panel">
                <div className="tabs">
                  {[
                    ["players", t.players],
                    ["assets", t.assets],
                    ["log", t.log],
                  ].map(([id, label]) => (
                    <button
                      className={tab === id ? "active" : ""}
                      key={id}
                      onClick={() => setTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "players" && (
                  <div className="player-list">
                    {state.order.map((id, i) => {
                      const p = state.players[id];
                      return (
                        <div
                          className={`player-card ${turn?.playerId === id ? "current" : ""} ${p.status === "BANKRUPT" ? "eliminated" : ""}`}
                          key={id}
                        >
                          <span
                            className="avatar"
                            style={{ background: colors[i] }}
                          >
                            {i + 1}
                          </span>
                          <div className="player-info">
                            <b>
                              {p.name} {id === userId && <small>(bạn)</small>}
                            </b>
                            <small>
                              {p.status === "BANKRUPT"
                                ? "Phá sản"
                                : state.status === "LOBBY"
                                  ? p.ready
                                    ? "✓ Sẵn sàng"
                                    : "Đang chuẩn bị"
                                  : p.controller === "BOT"
                                    ? "Bot đang chơi"
                                    : !p.connected
                                      ? "Mất kết nối · chờ 90s"
                                      : p.jail !== null
                                        ? "Trong tù"
                                        : `${Object.values(state.properties).filter((x) => x.ownerId === id).length} bất động sản`}
                            </small>
                          </div>
                          <strong>{money(p.cash)}</strong>
                        </div>
                      );
                    })}
                  </div>
                )}
                {tab === "assets" && (
                  <div className="asset-list">
                    {Object.entries(state.properties)
                      .filter(([, p]) => p.ownerId === userId)
                      .map(([id, p]) => (
                        <button
                          key={id}
                          onClick={() => selectTile(BOARD[Number(id)])}
                        >
                          <span
                            className="property-strip"
                            style={{ background: BOARD[Number(id)].color }}
                          />
                          <span>
                            <b>{BOARD[Number(id)].name}</b>
                            <small>
                              {p.mortgaged
                                ? "Đang cầm cố"
                                : p.level === 5
                                  ? "Khách sạn"
                                  : `${p.level} nhà`}
                            </small>
                          </span>
                          <span>{money(BOARD[Number(id)].price!)}</span>
                        </button>
                      ))}
                    {!Object.values(state.properties).some(
                      (p) => p.ownerId === userId,
                    ) && <p className="empty">Bạn chưa có bất động sản.</p>}
                    {me?.cards.map((id) => (
                      <div className="held-card" key={id}>
                        ★ {CARDS.find((x) => x.id === id)?.text}
                      </div>
                    ))}
                  </div>
                )}
                {tab === "log" && (
                  <div className="event-log">
                    {[...state.events].reverse().map((e) => (
                      <div key={e.id}>
                        <time>
                          {new Date(e.at).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        <p>{eventText(e, state)}</p>
                      </div>
                    ))}
                    {!state.events.length && (
                      <p className="empty">
                        Diễn biến ván đấu sẽ xuất hiện ở đây.
                      </p>
                    )}
                  </div>
                )}
                {state.status === "LOBBY" && (
                  <div className="lobby-controls">
                    {role === "PLAYER" && (
                      <button
                        className={me?.ready ? "" : "primary"}
                        disabled={disabled}
                        onClick={() =>
                          send({ type: "SET_READY", ready: !me?.ready })
                        }
                      >
                        {me?.ready ? t.unready : t.ready}
                      </button>
                    )}
                    {state.hostPlayerId === userId && (
                      <>
                        <details>
                          <summary>Luật phòng</summary>
                          {options}
                          <button
                            disabled={disabled}
                            onClick={() =>
                              send({
                                type: "UPDATE_ROOM_RULES",
                                rules: roomRules,
                              })
                            }
                          >
                            Lưu luật
                          </button>
                        </details>
                        <button
                          className="primary"
                          disabled={
                            disabled ||
                            state.order.length < 2 ||
                            !state.order.every((id) => state.players[id].ready)
                          }
                          onClick={() => send({ type: "START_GAME" })}
                        >
                          {t.start}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {state.result && (
                  <div className="results">
                    {state.result.map((r) => (
                      <p key={r.playerId}>
                        <b>
                          #{r.rank} {state.players[r.playerId].name}
                        </b>
                        <span>{money(r.assets)}</span>
                      </p>
                    ))}
                  </div>
                )}
              </section>
              {openTrades.map((tr) => (
                <section className="panel trade-card" key={tr.id}>
                  <h3>Đề nghị giao dịch</h3>
                  {tr.sides.map((side) => (
                    <p key={side.playerId}>
                      <b>{state.players[side.playerId].name}</b> gửi{" "}
                      {money(side.cash)}
                      {side.tileIds.length > 0 &&
                        ` + ${side.tileIds.map((id) => BOARD[Number(id)].name).join(", ")}`}
                      {side.cardIds.length > 0 &&
                        ` + ${side.cardIds.length} thẻ ra tù`}
                    </p>
                  ))}
                  <small>
                    Còn{" "}
                    {Math.max(
                      0,
                      Math.ceil((tr.expiresAt - now - offset) / 1000),
                    )}
                    s · {tr.confirmedBy.length}/2 xác nhận
                  </small>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={disabled || tr.confirmedBy.includes(userId)}
                      onClick={() =>
                        send({
                          type: "TRADE_CONFIRM",
                          tradeId: tr.id,
                          revision: tr.revision,
                        })
                      }
                    >
                      {tr.confirmedBy.includes(userId)
                        ? "Đã xác nhận"
                        : t.confirm}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        send({ type: "TRADE_CANCEL", tradeId: tr.id })
                      }
                    >
                      {t.cancel}
                    </button>
                  </div>
                </section>
              ))}
              <section className="panel chat-panel">
                <div className="panel-title">
                  <h2>{t.chat}</h2>
                  <span>{state.order.length} người chơi</span>
                </div>
                <div className="messages" aria-live="polite">
                  {chat.length ? (
                    chat.map((m) => (
                      <p key={m.id}>
                        <b
                          style={{
                            color:
                              colors[
                                Math.max(0, state.order.indexOf(m.userId))
                              ],
                          }}
                        >
                          {state.players[m.userId]?.name || t.spectator}
                        </b>{" "}
                        {m.text || m.emojiId}
                      </p>
                    ))
                  ) : (
                    <p className="empty">Chào bạn bè trước khi lên đường 👋</p>
                  )}
                </div>
                <div className="reactions">
                  {["👏", "😂", "😮", "❤️", "🎉", "🤝"].map((e) => (
                    <button
                      aria-label={e}
                      key={e}
                      disabled={!connected}
                      onClick={() =>
                        send({ type: "REACTION_SEND", emojiId: e })
                      }
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <form
                  className="chat-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (chatText.trim()) {
                      send({ type: "CHAT_SEND", text: chatText });
                      setChatText("");
                    }
                  }}
                >
                  <input
                    aria-label="Tin nhắn"
                    maxLength={300}
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="Nhắn một lời…"
                  />
                  <button
                    disabled={!connected || !chatText.trim()}
                    aria-label={t.send}
                  >
                    ↗
                  </button>
                </form>
              </section>
            </>
          )}
        </aside>
      </div>
      <footer className="page-footer">
        <span>TỶ PHÚ VIỆT</span>
        <span>Mỗi chuyến đi, một cơ hội mới.</span>
        <span>Không sử dụng tiền thật.</span>
      </footer>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div
            className="property-banner"
            style={{ background: selected.color }}
          >
            {selected.kind === "LAND" ? "BẤT ĐỘNG SẢN" : symbols[selected.kind]}
          </div>
          {selected.price ? (
            <>
              <div className="property-price">
                <span>Giá mua</span>
                <b>{money(selected.price)}</b>
              </div>
              <p>
                Chủ sở hữu:{" "}
                <b>
                  {state?.properties[selected.id]?.ownerId
                    ? state.players[state.properties[selected.id].ownerId!].name
                    : "Ngân hàng"}
                </b>
              </p>
              <table className="rent-table">
                <tbody>
                  {selected.rents?.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {selected.kind === "LAND"
                          ? i === 0
                            ? "Đất trống"
                            : i === 5
                              ? "Khách sạn"
                              : `${i} nhà`
                          : selected.kind === "AIRPORT"
                            ? `${i + 1} sân bay`
                            : `${i + 1} công ty`}
                      </td>
                      <td>
                        {money(r)}
                        {selected.kind === "UTILITY" ? " × xúc xắc" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selected.buildCost && (
                <p>
                  Xây mỗi cấp: <b>{money(selected.buildCost)}</b>
                </p>
              )}
              <p>
                Cầm cố:{" "}
                {money(
                  Math.floor(
                    selected.price * (state?.rules.mortgageRatio ?? 0.5),
                  ),
                )}{" "}
                · Chuộc:{" "}
                {money(
                  Math.round(
                    Math.floor(
                      selected.price * (state?.rules.mortgageRatio ?? 0.5),
                    ) * (state?.rules.redeemRatio ?? 1.1),
                  ),
                )}
              </p>
              {state?.properties[selected.id]?.ownerId === userId &&
                (manage || hasDebt) && (
                  <div className="property-actions">
                    {manage && selected.kind === "LAND" && (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          send({ type: "BUILD", tileId: selected.id })
                        }
                      >
                        {t.build}
                      </button>
                    )}
                    {selected.kind === "LAND" && (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          send({ type: "SELL_BUILDING", tileId: selected.id })
                        }
                      >
                        {t.sell}
                      </button>
                    )}
                    {state.properties[selected.id].mortgaged ? (
                      <button
                        disabled={disabled || !manage}
                        onClick={() =>
                          send({ type: "REDEEM", tileId: selected.id })
                        }
                      >
                        {t.redeem}
                      </button>
                    ) : (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          send({ type: "MORTGAGE", tileId: selected.id })
                        }
                      >
                        {t.mortgage}
                      </button>
                    )}
                  </div>
                )}
            </>
          ) : (
            <p>
              {selected.kind === "GO"
                ? "Nhận 2.000.000đ mỗi lần đi qua Xuất Phát."
                : selected.kind === "JAIL"
                  ? "Đứng ở ô này chỉ là thăm tù, trừ khi bị đưa vào tù."
                  : selected.kind === "GO_TO_JAIL"
                    ? "Đi thẳng đến tù. Không nhận tiền Xuất Phát."
                    : selected.kind === "PARKING"
                      ? "Nghỉ chân miễn phí. Không có phần thưởng ngân hàng."
                      : selected.kind === "TAX"
                        ? `Nộp ${money(selected.amount!)} cho ngân hàng.`
                        : "Rút một thẻ và thực hiện hiệu ứng do server quyết định."}
            </p>
          )}
        </Modal>
      )}
      {tradeOpen && state && (
        <Modal title={t.trade} onClose={() => setTradeOpen(false)}>
          <label>
            Giao dịch với
            <select
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setTakeTiles([]);
                setTakeCards([]);
              }}
            >
              {state.order
                .filter(
                  (id) =>
                    id !== userId && state.players[id].status === "ACTIVE",
                )
                .map((id) => (
                  <option key={id} value={id}>
                    {state.players[id].name}
                  </option>
                ))}
            </select>
          </label>
          <div className="trade-columns">
            {[
              {
                id: userId,
                title: "Bạn gửi",
                cash: giveCash,
                setCash: setGiveCash,
                tiles: giveTiles,
                setTiles: setGiveTiles,
                cards: giveCards,
                setCards: setGiveCards,
              },
              {
                id: to,
                title: "Bạn nhận",
                cash: takeCash,
                setCash: setTakeCash,
                tiles: takeTiles,
                setTiles: setTakeTiles,
                cards: takeCards,
                setCards: setTakeCards,
              },
            ].map((side) => (
              <div key={side.title}>
                <h3>{side.title}</h3>
                <label>
                  Tiền (đ)
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    value={side.cash}
                    onChange={(e) => side.setCash(Number(e.target.value))}
                  />
                </label>
                {Object.entries(state.properties)
                  .filter(([, p]) => p.ownerId === side.id)
                  .map(([id]) => (
                    <label className="check" key={id}>
                      <input
                        type="checkbox"
                        checked={side.tiles.includes(id)}
                        onChange={() => toggle(side.tiles, side.setTiles, id)}
                      />
                      {BOARD[Number(id)].name}
                    </label>
                  ))}
                {side.id === userId ? (
                  me?.cards.map((id) => (
                    <label className="check" key={id}>
                      <input
                        type="checkbox"
                        checked={side.cards.includes(id)}
                        onChange={() => toggle(side.cards, side.setCards, id)}
                      />
                      Thẻ ra tù
                    </label>
                  ))
                ) : (
                  <>
                    {CARDS.filter((c) => c.kind === "GET_OUT").map((c) => (
                      <label className="check" key={c.id}>
                        <input
                          type="checkbox"
                          checked={side.cards.includes(c.id)}
                          onChange={() =>
                            toggle(side.cards, side.setCards, c.id)
                          }
                        />
                        Xin thẻ ra tù (
                        {c.deck === "CHANCE" ? "Cơ Hội" : "Khí Vận"})
                      </label>
                    ))}
                    <small>
                      Server sẽ kiểm tra đối phương có giữ thẻ được đề nghị.
                    </small>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="muted">
            Hai bên phải xác nhận. Giao dịch hết hạn sau tối đa 60 giây hoặc khi
            lượt kết thúc.
          </p>
          <button
            className="primary full"
            disabled={disabled || !manage || !to}
            onClick={() => {
              const sides: [TradeSide, TradeSide] = [
                {
                  playerId: userId,
                  cash: giveCash,
                  tileIds: giveTiles,
                  cardIds: giveCards,
                },
                {
                  playerId: to,
                  cash: takeCash,
                  tileIds: takeTiles,
                  cardIds: takeCards,
                },
              ];
              send({ type: "TRADE_OFFER", sides });
              setTradeOpen(false);
            }}
          >
            Gửi đề nghị
          </button>
        </Modal>
      )}
    </main>
  );
}
