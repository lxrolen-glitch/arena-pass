import type { Metadata } from "next";

import { RoomView } from "@/components/RoomView";

export const metadata: Metadata = {
  title: "Poker table — Arena Poker",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <RoomView code={code.toUpperCase()} />;
}
