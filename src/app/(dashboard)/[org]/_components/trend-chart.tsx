"use client"; // Recharts はブラウザで描画する

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const config = {
  count: { label: "予約数", color: "var(--chart-2)" },
} satisfies ChartConfig;

export type TrendPoint = {
  date: string;
  label: string;
  count: number;
};

/**
 * 予約推移の棒グラフ。グラフは支援技術に読まれないので aria-hidden にし、
 * 同じ数値は呼び出し側で表（sr-only）として出す。
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full"
      aria-hidden="true"
    >
      <BarChart data={data} margin={{ left: -20, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
