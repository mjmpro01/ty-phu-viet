# Tỷ Phú Việt

Game mua bán bất động sản chủ đề Việt Nam, 2–6 người chơi thời gian thực.
Monorepo TypeScript: **Next.js 15 / Tailwind / Zustand**, **Node.js / Socket.IO**, **Redis**, **PostgreSQL / Prisma**.

## Chạy toàn bộ bằng Docker Compose

Yêu cầu Docker Engine và Docker Compose v2. Không cần cài Node trên máy host.

```bash
cp .env.example .env
docker compose up --build
```

- Mở http://localhost:3000.
- Nhập tên, tạo phòng; người khác nhập mã 6 ký tự hoặc mở link phòng.
- Dùng hai trình duyệt hoặc hai tab độc lập để thử hai người. Phiên guest nằm trong `sessionStorage`; khi nhân bản tab trình duyệt có thể sao chép phiên, hãy dùng tab mới/incognito nếu muốn người chơi khác.
- Tất cả người chơi bấm **Sẵn sàng**, chủ phòng bấm **Bắt đầu ván**.
- Spectator có thể vào phòng đã bắt đầu.
- Migration chạy qua service `migrate` trước khi server khởi động.
- Redis/Postgres lưu dữ liệu trong named volumes; `docker compose down` giữ dữ liệu, `down -v` xóa dữ liệu.

Hot reload source bằng Compose:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

### Chơi từ điện thoại cùng mạng LAN

Đổi `.env` sang IP LAN của máy chạy Docker, ví dụ:

```dotenv
NEXT_PUBLIC_SERVER_URL=http://192.168.1.10:3001
WEB_ORIGIN=http://192.168.1.10:3000,http://localhost:3000
```

Build lại web vì `NEXT_PUBLIC_SERVER_URL` được nhúng khi build:

```bash
docker compose up --build
```

Mở `http://192.168.1.10:3000` trên điện thoại. Máy host cần cho phép truy cập cổng 3000 và 3001 trong mạng LAN. Mã phòng không phải mật khẩu; phòng private chỉ bị ẩn khỏi danh sách public.

## Chạy source bằng Node

Yêu cầu Node.js 22+ và pnpm 10.11.0.

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install --frozen-lockfile
pnpm db:generate
docker compose up -d postgres redis
cp .env.example .env
```

Nạp các biến `.env` vào terminal rồi migrate/chạy server (Bash/macOS/Linux):

```bash
set -a
. ./.env
set +a
pnpm db:migrate
pnpm dev
```

Trên PowerShell, đặt các biến `$env:DATABASE_URL`, `$env:REDIS_URL`, `$env:WEB_ORIGIN`, `$env:NEXT_PUBLIC_SERVER_URL` theo `.env.example` trước khi chạy lệnh.

### Chạy thử tạm thời không có database

Hai terminal từ root:

```bash
MEMORY_STORE=1 pnpm --filter @tpv/server dev
pnpm --filter @tpv/web dev
```

Đây là **chế độ in-memory rõ ràng**, vẫn dùng server authoritative và Socket.IO thật. Không lưu user/phòng/lịch sử qua lần restart. Server mặc định từ chối chạy thiếu Redis/Postgres; không tự âm thầm chuyển sang memory.

## Kiểm thử và build

```bash
pnpm db:generate
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm build
```

Vitest đặt threshold **80% statements, branches, functions, lines** cho toàn bộ `packages/shared/src/engine/**/*.ts` (không loại nhánh luật khỏi coverage). Báo cáo HTML ở `coverage/index.html`.

- Unit tests: tính thuê, xây đều, nguồn cung nhà/khách sạn, cầm cố/chuộc, đấu giá, giao dịch, phá sản, tù, timeout, reconnect/bot, kết thúc theo thời gian.
- Socket.IO integration: hai client thật, patch, gửi lại command, validation, spectator, reconnect, bid đồng thời, chat.
- Hai integration test Redis/Postgres thật chỉ chạy khi có biến môi trường dưới đây. Chỉ trỏ chúng tới **database/Redis dành riêng cho test**:

```bash
TEST_REDIS_URL=redis://localhost:6379/15 \
TEST_DATABASE_URL=postgresql://tpv:tpv_dev_password@localhost:5432/tpv_test \
pnpm test
```

Tạo database `tpv_test` và chạy migration vào database đó trước. Redis test ghi outbox trong database 15; không dùng Redis này cho phiên chơi thật.

Xem [docs/verification.md](docs/verification.md) để biết chính xác kiểm chứng đã thực hiện trong môi trường bàn giao. Có source tích hợp Redis/Postgres và migration; không suy diễn rằng Docker đã chạy thành công nếu báo cáo ghi chưa chạy.

## Cấu trúc

```text
apps/web/src/
  app/                  # App Router: /, /lobby, /room/[code]
  components/Game.tsx   # Board, actions, lobby, property dialog, trade/chat
  lib/store.ts          # Zustand + socket + patch + retry
  i18n/                 # vi.json / en.json
apps/server/
  src/server.ts         # Gateway, session, room command scheduling
  src/store.ts          # Redis transaction/lease/CAS, outbox; memory test adapter
  src/persistence.ts    # Prisma projection and idempotent audit persistence
  src/main.ts           # Runtime configuration and graceful shutdown
  prisma/               # Schema + initial SQL migration
packages/shared/src/
  config/               # Board, card decks, numeric defaults in JSON
  protocol.ts           # Zod payloads/envelope
  types.ts              # Internal/public state types
  engine/game.ts        # Pure turn state machine
  engine/economy.ts     # Rent/buildings/mortgage/bankruptcy
  engine/exchanges.ts   # Auction and two-party trades
```

Source được chia theo boundary thực thi, một số file trong bản thiết kế được gộp để tránh các wrapper chỉ chuyển tiếp. Không có service hoặc database logic trong web.

## Luật đã chốt

- Bàn **40 ô**: 24 đất / 8 nhóm × 3 đất, 4 sân bay, 2 điện/nước, 2 Cơ Hội, 2 Khí Vận, 4 góc, 2 thuế.
- Vốn 15.000.000đ; đi qua Xuất Phát nhận 2.000.000đ.
- Đất trống của nhóm hoàn chỉnh không cầm cố: thuê ×2; có nhà dùng bảng giá nhà.
- Sân bay theo số sân bay sở hữu; điện/nước theo tổng xúc xắc di chuyển.
- Xây đều 0–4 nhà, cấp 5 là khách sạn; ngân hàng mặc định 32 nhà, 12 khách sạn.
- Bán nhà hoàn 50%; bán đều. Trước khi cầm cố một đất, bán hết công trình trong nhóm.
- Cầm cố nhận 50% giá mua. **Chuộc một lần bằng 110% khoản cầm cố**, không có trả góp định kỳ.
- Đấu giá sau từ chối mua; bước giá 100.000đ, 15 giây; người từ chối vẫn tham gia. Người đang dẫn đầu không được bỏ đấu giá. Tiền bid được giữ chỗ khi kiểm tra trade.
- Tung đôi có thêm lượt; ba lần đôi liên tiếp vào tù. Đôi để ra tù không có thêm lượt.
- Tù: tối đa ba lần tung, trả 500.000đ hoặc dùng thẻ. Lần tung thứ ba không đôi phải thanh toán rồi di chuyển.
- Trade gồm tiền, đất không có công trình và thẻ ra tù. Cả hai bên xác nhận đúng revision; chuyển nguyên tử. Một trade đang mở/phòng; tối đa 60 giây hoặc kết thúc lượt. Người nhận có thể xác nhận ngoài lượt mình.
- Khi buộc thanh lý: bán toàn bộ công trình của từng nhóm theo thứ tự ô, rồi cầm cố theo thứ tự ô; dừng khi đủ tiền. Việc bán cả nhóm tránh deadlock khi ngân hàng thiếu nhà để đổi khách sạn.
- Phá sản: bán công trình, chuyển tiền còn lại, đất và thẻ cho chủ nợ; giữ trạng thái cầm cố. Nợ ngân hàng thì trả đất sạch về ngân hàng và thẻ về bộ bài.
- Ván timed: giải quyết nghĩa vụ đang phát sinh, tính `tiền + giá mua đất + chi phí xây dựng - khoản chuộc cầm cố - nợ`; đồng điểm thì đồng hạng. Người đã phá sản xếp sau người còn hoạt động.
- Hai bộ bài là bộ thẻ Việt Nam ban đầu, có thưởng/phí, tiến về Xuất Phát, đi tù và thẻ ra tù; mở rộng trong JSON và engine.

## Server authoritative và đồng bộ

Client không quyết định kết quả xúc xắc, số tiền, chủ đất, di chuyển hay chuyển lượt. Mọi thay đổi đi qua Zod, kiểm tra người chơi, state và transaction phòng.

```
WAITING → ROLLING → MOVING → RESOLVING_TILE → ACTION → END_TURN
```

State `ACTION` phân biệt `PURCHASE`, `AUCTION`, `DEBT`, `MANAGE`. Tù có nhánh đi thẳng đến `END_TURN` hoặc trả tiền rồi `MOVING`. Các animation có thời gian hoàn tất do server quản lý; không chờ callback client.

- Xúc xắc: `crypto.randomInt(1, 7)` trên server. Không có seed tái lập của API này. Lưu kết quả dice và turn ID để audit; đây không phải cơ chế provably-fair.
- Redis transaction dùng lease có token duy nhất + so sánh version. Writer hết lease không thể commit. Mỗi lệnh nắm quyền ghi riêng trong thời gian xử lý; không gán phòng vĩnh viễn cho một Node process.
- State, receipt dedup và outbox được commit nguyên tử trước khi broadcast. Command lặp cùng ID/actor trả receipt cũ; dedup Redis giữ 24 giờ.
- Redis adapter chuyển chat/reaction giữa instances; Pub/Sub `tpv:changed` thông báo các gateway nạp projection mới.
- Mỗi socket chỉ nhận diff trên projection của mình. Không gửi bộ bài, discard và hand của người khác. Trade chỉ hiện cho hai bên.
- JSON Patch có stream ID, base sequence, sequence và version. Join/reconnect nhận snapshot; đang kết nối bị thiếu patch thì replay buffer 128 bản, ngoài cửa sổ thì snapshot.
- Reconnect dùng bearer token guest ngẫu nhiên 256 bit, hash trong Redis, hạn 30 ngày; token không nằm trong state hoặc log. Mất mạng giữ ghế 90s, đồng hồ không reset. Sau đó bot tung, bỏ mua/bid/trade, xử lý nghĩa vụ bắt buộc. Người quay lại nhận quyền khi bắt đầu lượt kế tiếp.
- Presence sweep kiểm tra socket của từng ghế trên các instance để nhận ra crash process. Explicit leave ở lobby xóa ghế/chuyển host; trong ván giữ ghế để bot thay.
- Scheduler dùng deadline tuyệt đối đã persist nên restart không reset đồng hồ.

## Persistence và vận hành

Prisma models: `User`, `Match`, `MatchParticipant`, `MatchEvent`, `DiceAudit`, `MatchCheckpoint`. Phiên guest lưu Redis; bảng lịch sử user là danh tính guest, chưa có đăng nhập OAuth/email.

Outbox được chuyển sang Postgres idempotent theo `(matchId, sequence)`, có khóa hàng Match và checkpoint version để chống ghi lùi. Redis giữ snapshot phục hồi nhanh; Postgres giữ checkpoint và lịch sử. **Chưa có thao tác tự khôi phục Redis mất toàn bộ dữ liệu từ Postgres**; không xóa Redis volumes khi đang có ván.

Giới hạn vận hành cụ thể:

- `appendfsync everysec` có thể mất khoảng một giây dữ liệu Redis khi host/storage crash. ACK sau Redis commit không tương đương đồng bộ fsync hay Postgres commit. Cần chọn cấu hình durability phù hợp trước production.
- Khi Redis không truy cập được, intent bị từ chối/tạm ngừng; không ACK giả. Postgres lỗi thì outbox giữ lại và thử lại.
- Chưa có TTL/archiver cho snapshot phòng đã kết thúc, outbox capacity guard, dashboard vận hành hoặc stress test production. Cần thêm trước khi chạy số lượng phòng lớn.
- Health endpoint hiện kiểm tra HTTP process, không phải readiness sâu của DB.
- Rate limit cơ bản theo socket và handshake IP trong mỗi process; cần edge/shared rate limit nếu triển khai Internet nhiều instance.
- Socket dùng WebSocket transport; reverse proxy phải hỗ trợ Upgrade, TLS và origin đúng. Không tin `playerId` từ client.
- `.env.example`/Compose dành cho dev. Triển khai Internet cần HTTPS/WSS, secrets riêng và backup.

## UI và i18n

Bàn vuông responsive; mobile portrait dùng bảng chi tiết khi chạm ô. Các nhãn ô được thu gọn vì bàn 40 ô, tên/giá đầy đủ ở dialog. Animation di chuyển từng ô và xúc xắc CSS; tôn trọng `prefers-reduced-motion`.

Giao diện chính tiếng Việt, tiền `1.500.000đ`. Có `vi.json/en.json` và nút đổi ngôn ngữ cho các điều khiển chính; tên địa danh, nội dung thẻ, một số trợ giúp và log vẫn tiếng Việt. Đây là nền tảng i18n sẵn mở rộng, chưa phải bản dịch English toàn bộ.

Không có ảnh/âm thanh thương hiệu bên thứ ba. Bàn cờ, token, xúc xắc dùng CSS/ký tự Unicode; không dùng đồ họa Monopoly.
