import Game from "../../../components/Game";
export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Game initialCode={code} />;
}
