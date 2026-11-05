import { positions, walletPublicColumns, wallets } from "@kubstake/db";
import { asc, count, sql } from "drizzle-orm";
import { TriangleAlertIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { Kub } from "@/components/kub";
import { KvList, KvRow } from "@/components/kv";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addressUrl, formatDateTime, formatKub, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeleteWalletButton } from "./delete-wallet-button";
import { WalletForm } from "./wallet-form";

export const metadata: Metadata = { title: "กระเป๋า · KUB Stake Auto-Compound" };

type WalletListItem = {
  id: string;
  label: string;
  address: string;
  balanceWei: bigint | null;
  balanceUpdatedAt: Date | null;
  positionCount: number;
  /** positions with principal > 0 or pending reward > 0 */
  fundedCount: number;
  principalWei: bigint;
  pendingWei: bigint;
};

async function loadWallets(): Promise<{ rows: WalletListItem[]; error: string | null }> {
  try {
    const db = getDb();
    const [list, totals] = await Promise.all([
      // walletPublicColumns: never select wallets.encrypted_key in web
      db.select(walletPublicColumns).from(wallets).orderBy(asc(wallets.createdAt)),
      db
        .select({
          walletId: positions.walletId,
          positionCount: count(),
          fundedCount: sql<number>`count(*) filter (where ${positions.principalWei} > 0 or ${positions.pendingWei} > 0)`.mapWith(
            Number,
          ),
          principalWei: sql<string>`coalesce(sum(${positions.principalWei}), 0)::text`,
          pendingWei: sql<string>`coalesce(sum(${positions.pendingWei}), 0)::text`,
        })
        .from(positions)
        .groupBy(positions.walletId),
    ]);
    const byWallet = new Map(totals.map((t) => [t.walletId, t]));
    const rows = list.map((w): WalletListItem => {
      const t = byWallet.get(w.id);
      return {
        id: w.id,
        label: w.label,
        address: w.address,
        balanceWei: w.balanceWei,
        balanceUpdatedAt: w.balanceUpdatedAt,
        positionCount: t?.positionCount ?? 0,
        fundedCount: t?.fundedCount ?? 0,
        principalWei: BigInt(t?.principalWei ?? "0"),
        pendingWei: BigInt(t?.pendingWei ?? "0"),
      };
    });
    return { rows, error: null };
  } catch (err) {
    console.error(`[wallets] load failed: ${err instanceof Error ? err.message : String(err)}`);
    return { rows: [], error: "อ่านรายการ wallet จากฐานข้อมูลไม่สำเร็จ" };
  }
}

function AddressLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-mono text-xs underline-offset-4 hover:underline", className)}
      title="เปิดใน kubscan"
    >
      {address}
    </a>
  );
}

function BalanceValue({ w }: { w: WalletListItem }) {
  if (w.balanceWei === null) {
    return (
      <span className="text-muted-foreground" title="worker ยังไม่ได้อ่าน balance ของ wallet นี้">
        รอ worker
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end">
      <Kub value={formatKub(w.balanceWei)} />
      <span className="text-muted-foreground text-xs" title={w.balanceUpdatedAt ? formatDateTime(w.balanceUpdatedAt) : undefined}>
        {relativeTime(w.balanceUpdatedAt)}
      </span>
    </div>
  );
}

function PositionValue({ w }: { w: WalletListItem }) {
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums">{w.positionCount}</span>
      {w.principalWei > 0n ? (
        <span className="text-muted-foreground text-xs">
          stake <Kub value={formatKub(w.principalWei)} />
        </span>
      ) : null}
    </div>
  );
}

function DeleteButton({ w }: { w: WalletListItem }) {
  return (
    <DeleteWalletButton
      walletId={w.id}
      label={w.label}
      address={w.address}
      positionCount={w.positionCount}
      needsConfirm={w.fundedCount > 0}
      stakedKub={formatKub(w.principalWei)}
      pendingKub={formatKub(w.pendingWei)}
    />
  );
}

export default async function WalletsPage() {
  await requireSession();
  const { rows, error } = await loadWallets();

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />
      <PageHeader
        title="กระเป๋า (Wallets)"
        description="wallet ที่ระบบใช้ delegate / claim / compound — balance อ่านจาก chain โดย worker ทุกรอบ (หน้านี้รีเฟรชเองทุก 15 วินาที)"
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-center gap-2">
            รายการ wallet
            {rows.length > 0 ? <Badge className="tabular-nums">{rows.length}</Badge> : null}
          </CardTitle>
          {rows.length > 0 ? <CardDescription>{`ทั้งหมด ${rows.length} wallet`}</CardDescription> : null}
        </CardHeader>
        {rows.length > 0 ? (
          <>
            {/* desktop: table · phones: one card per wallet (same data) */}
            <CardContent className="hidden px-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ชื่อ</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Position</TableHead>
                    <TableHead className="w-0">
                      <span className="sr-only">จัดการ</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="max-w-48 truncate font-medium" title={w.label}>
                        {w.label}
                      </TableCell>
                      <TableCell>
                        <AddressLink address={w.address} />
                      </TableCell>
                      <TableCell className="text-right">
                        <BalanceValue w={w} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PositionValue w={w} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteButton w={w} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
            <CardContent className="px-0 md:hidden">
              <ul className="divide-y divide-border">
                {rows.map((w) => (
                  <li key={w.id} className="flex flex-col gap-2 px-(--card-spacing) py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate font-medium" title={w.label}>
                        {w.label}
                      </div>
                      <DeleteButton w={w} />
                    </div>
                    <AddressLink address={w.address} className="break-all text-muted-foreground hover:text-foreground" />
                    <KvList>
                      <KvRow label="Balance">
                        <BalanceValue w={w} />
                      </KvRow>
                      <KvRow label="Position">
                        <PositionValue w={w} />
                      </KvRow>
                    </KvList>
                  </li>
                ))}
              </ul>
            </CardContent>
          </>
        ) : !error ? (
          <CardContent>
            <EmptyState icon={WalletIcon} title="ยังไม่มี wallet" description="เพิ่ม wallet แรกด้วย private key ด้านล่าง" />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>เพิ่ม wallet</CardTitle>
          <CardDescription>ใส่ private key ของ wallet บน KUB Chain — ระบบจะคำนวณ address ให้เอง</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Hot wallet</AlertTitle>
            <AlertDescription>
              key จะถูกเข้ารหัสด้วย MASTER_KEY และเก็บใน DB — ใช้ hot wallet ที่ใส่เงินเท่าที่จำเป็นเท่านั้น และเก็บ backup
              ของ private key ไว้เองเสมอ
            </AlertDescription>
          </Alert>
          <WalletForm />
        </CardContent>
      </Card>
    </div>
  );
}
