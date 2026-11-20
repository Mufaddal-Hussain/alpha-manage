export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <div className="mx-auto flex max-w-3xl flex-col gap-6">{children}</div>;
}
