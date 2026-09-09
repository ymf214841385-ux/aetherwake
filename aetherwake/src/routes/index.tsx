import { createFileRoute } from "@tanstack/react-router";
import { GameApp } from "@/game/Game";

export const Route = createFileRoute("/")({
  component: GameApp,
});
