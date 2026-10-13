import MatchView from "@/components/MatchView";

export default async function MatchPage({ params }: PageProps<"/match/[id]">) {
  const { id } = await params;
  return <MatchView matchId={id} />;
}
