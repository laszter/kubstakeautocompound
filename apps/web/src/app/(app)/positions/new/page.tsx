import { ServerIcon, TriangleAlertIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth";
import { formatKub } from "@/lib/format";
import { getWorkerStatus, type WorkerStatusInfo } from "@/lib/worker";
import { DEFAULT_HINT_SETTINGS, effectiveGasPrice, isValidatorDelegatable, maxDelegatableWei } from "../_lib/hints";
import { isUuid } from "../_lib/position-fields";
import { loadNewPositionOptions } from "../_lib/queries";
import { NewPositionForm, type ValidatorOption, type WalletOption } from "./new-position-form";

export const metadata: Metadata = { title: "สร้าง position · KUB Stake Auto-Compound" };

type Options = Awaited<ReturnType<typeof loadNewPositionOptions>>;

async function load(): Promise<{ options: Options; worker: WorkerStatusInfo } | null> {
  try {
    const [options, worker] = await Promise.all([loadNewPositionOptions(), getWorkerStatus()]);
    return { options, worker };
  } catch (err) {
    console.error(`[positions:new] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function NewPositionPage(props: PageProps<"/positions/new">) {
  await requireSession();
  const sp = await props.searchParams;
  const loaded = await load();

  const header = (
    <PageHeader
      backHref="/"
      backLabel="แดชบอร์ด"
      title="สร้าง position"
      description="position = wallet × validator — แต่ละอันมีการตั้งค่า auto-compound ของตัวเอง (ตั้งได้ในหน้า position หลังสร้าง)"
    />
  );

  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertTitle>ฐานข้อมูลไม่พร้อม</AlertTitle>
          <AlertDescription>อ่านรายชื่อ wallet / validator ไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { options, worker } = loaded;
  const settings = options.settings ?? DEFAULT_HINT_SETTINGS;
  const gas = effectiveGasPrice(worker.heartbeat?.gasPriceWei);

  const wallets: WalletOption[] = options.wallets.map((w) => {
    const max = maxDelegatableWei(w.balanceWei, settings.gasReserveWei, gas.wei);
    return {
      id: w.id,
      label: w.label,
      address: w.address,
      balanceLabel: w.balanceWei !== null ? formatKub(w.balanceWei) : null,
      maxLabel: max !== null ? formatKub(max) : null,
    };
  });
  const delegatable = options.validators.filter(isValidatorDelegatable);
  const validators: ValidatorOption[] = delegatable.map((x) => ({
    id: String(x.validatorId),
    name: x.name ?? `Validator #${x.validatorId}`,
    commissionLabel: `${(x.commissionBps / 100).toLocaleString("en-US")}%`,
    minDelegatedLabel: formatKub(x.minDelegatedWei, 18),
    delegatedLabel: formatKub(x.delegatedWei, 0),
  }));
  const existing: Record<string, string> = {};
  for (const e of options.existing) existing[`${e.walletId}:${e.validatorId}`] = e.id;

  // Preselect from ?validatorId= (validators page "Delegate" button) / ?walletId=, or the only wallet.
  const wantedValidator = first(sp.validatorId);
  const wantedWallet = first(sp.walletId);
  const preValidator = validators.find((x) => x.id === wantedValidator)?.id ?? "";
  const unknownValidator = wantedValidator !== "" && preValidator === "";
  const closedValidator = unknownValidator
    ? options.validators.find((x) => String(x.validatorId) === wantedValidator)
    : undefined;
  const preWallet =
    (isUuid(wantedWallet) ? wallets.find((w) => w.id === wantedWallet)?.id : undefined) ??
    (wallets.length === 1 ? wallets[0]!.id : "");

  return (
    <div className="flex flex-col gap-6">
      {header}

      {wallets.length === 0 ? (
        <Card className="max-w-2xl">
          <CardContent>
            <EmptyState
              icon={WalletIcon}
              title="ยังไม่มี wallet"
              description="ต้องเพิ่ม wallet (private key) ก่อนจึงจะสร้าง position ได้"
              action={
                <Link href="/wallets" className={buttonVariants()}>
                  ไปหน้ากระเป๋า
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : validators.length === 0 ? (
        <Card className="max-w-2xl">
          <CardContent>
            <EmptyState
              icon={ServerIcon}
              title="ยังไม่มี validator ที่เปิดรับ delegate"
              description={<>รายชื่อ validator มาจาก worker — ไปหน้า Validators แล้วกด &quot;รีเฟรชรายชื่อ&quot;</>}
              action={
                <Link href="/validators" className={buttonVariants()}>
                  ไปหน้า Validators
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader className="border-b">
            <CardTitle>Wallet × Validator</CardTitle>
            <CardDescription>
              ระบบแค่ส่งคำสั่งเข้าคิว — worker เป็นผู้ simulate/เซ็น/ส่ง tx · gas price ที่ใช้ประมาณ{" "}
              {gas.fallback ? "25 gwei (ยังไม่มีค่าจาก worker)" : "จาก worker ล่าสุด"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {unknownValidator ? (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertDescription>
                  {closedValidator
                    ? `Validator #${wantedValidator} ปิดรับ delegate อยู่ — เลือก validator อื่น`
                    : `ไม่พบ validator #${wantedValidator}`}
                </AlertDescription>
              </Alert>
            ) : null}
            <NewPositionForm
              wallets={wallets}
              validators={validators}
              existing={existing}
              initial={{ walletId: preWallet, validatorId: preValidator, amountKub: "" }}
              reserveLabel={formatKub(settings.gasReserveWei)}
              workerFresh={worker.fresh}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
