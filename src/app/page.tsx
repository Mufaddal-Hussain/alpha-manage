const modules = [
  "Price lists",
  "Quotations",
  "Delivery management",
  "Invoices",
  "Receipts",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">
          Work in progress
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          alpha-Manage
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Day-to-day business management for your tile business. This is an
          early preview: the first modules are being built now.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">Coming up</h2>
        <ul className="flex flex-wrap gap-2">
          {modules.map((m) => (
            <li
              key={m}
              className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
            >
              {m}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
