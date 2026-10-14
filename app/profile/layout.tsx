import TabTransition from "@/components/TabTransition";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <TabTransition>{children}</TabTransition>;
}
