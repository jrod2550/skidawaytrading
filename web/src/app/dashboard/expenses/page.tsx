"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Profile } from "@/lib/types/trading";

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
  receipt_url: string | null;
  receipt_filename: string | null;
  created_at: string;
}

interface ExpenseSummary {
  month: string;
  category: string;
  total: number;
  item_count: number;
}

const CATEGORIES = [
  { value: "unusual_whales", label: "Unusual Whales", color: "border-teal text-teal" },
  { value: "anthropic_api", label: "Anthropic API", color: "border-gold text-gold" },
  { value: "ibkr_commissions", label: "IBKR Commissions", color: "border-[oklch(0.60_0.12_200)] text-[oklch(0.65_0.12_200)]" },
  { value: "infrastructure", label: "Infrastructure", color: "border-sand text-sand" },
  { value: "hosting", label: "Hosting", color: "border-muted-foreground text-muted-foreground" },
  { value: "domain", label: "Domain", color: "border-muted-foreground text-muted-foreground" },
  { value: "other", label: "Other", color: "border-muted-foreground text-muted-foreground" },
];

function getCategoryStyle(cat: string) {
  return CATEGORIES.find((c) => c.value === cat)?.color ?? "border-muted-foreground text-muted-foreground";
}

function getCategoryLabel(cat: string) {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function ExpensesPage() {
  const supabase = createClient();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [category, setCategory] = useState("unusual_whales");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (prof) setProfile(prof);
      }

      const { data: exp } = await supabase
        .from("expenses")
        .select("*")
        .order("expense_date", { ascending: false })
        .limit(100);
      if (exp) setExpenses(exp);

      const { data: sum } = await supabase
        .from("expense_summary")
        .select("*");
      if (sum) setSummary(sum);
    }
    load();
  }, []);

  const isAdmin = profile?.role === "admin";

  const totalAllTime = expenses.reduce((sum, e) => sum + e.amount, 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const totalThisMonth = expenses
    .filter((e) => e.expense_date.startsWith(thisMonth))
    .reduce((sum, e) => sum + e.amount, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    let receiptUrl: string | null = null;
    let receiptFilename: string | null = null;

    // Upload receipt if provided
    if (file) {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(path, file);

      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage
          .from("receipts")
          .getPublicUrl(uploadData.path);
        receiptUrl = urlData.publicUrl;
        receiptFilename = file.name;
      }
    }

    const { error } = await supabase.from("expenses").insert({
      category,
      description,
      amount: parseFloat(amount),
      expense_date: expenseDate,
      receipt_url: receiptUrl,
      receipt_filename: receiptFilename,
      created_by: profile?.id,
    });

    if (!error) {
      await refreshData();

      // Reset form
      setDescription("");
      setAmount("");
      setFile(null);
      setDialogOpen(false);
    }

    setSubmitting(false);
  }

  async function refreshData() {
    const { data: exp } = await supabase
      .from("expenses")
      .select("*")
      .order("expense_date", { ascending: false })
      .limit(100);
    if (exp) setExpenses(exp);

    const { data: sum } = await supabase.from("expense_summary").select("*");
    if (sum) setSummary(sum);
  }

  async function handleDelete(expense: Expense) {
    setDeleting(expense.id);

    // Delete receipt from storage if it exists
    if (expense.receipt_url) {
      const path = expense.receipt_url.split("/receipts/").pop();
      if (path) {
        await supabase.storage.from("receipts").remove([decodeURIComponent(path)]);
      }
    }

    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (!error) {
      await refreshData();
    }
    setDeleting(null);
  }

  // Group summary by month
  const monthTotals = summary.reduce(
    (acc, s) => {
      const m = s.month;
      if (!acc[m]) acc[m] = 0;
      acc[m] += s.total;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Expenses</h2>
          <p className="text-muted-foreground">
            Infrastructure costs, API subscriptions, and receipts
          </p>
        </div>
        {isAdmin && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <Button onClick={() => setDialogOpen(true)} className="bg-teal text-teal-foreground hover:bg-teal/90">
              Add Expense
            </Button>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle>Add Expense</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-sand">
                    Category
                  </Label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-input px-3 text-sm text-foreground"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-sand">
                    Description
                  </Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Unusual Whales API Basic - April 2026"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-sand">
                      Amount ($)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="125.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-sand">
                      Date
                    </Label>
                    <Input
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-sand">
                    Receipt / Invoice (optional)
                  </Label>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    PDF, PNG, JPG up to 10MB. Visible to all members.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-teal text-teal-foreground hover:bg-teal/90"
                >
                  {submitting ? "Uploading..." : "Add Expense"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              This Month
            </p>
            <p className="text-xl font-bold font-mono">{fmtCurrency(totalThisMonth)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              All Time
            </p>
            <p className="text-xl font-bold font-mono">{fmtCurrency(totalAllTime)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Total Items
            </p>
            <p className="text-xl font-bold font-mono">{expenses.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Avg Monthly
            </p>
            <p className="text-xl font-bold font-mono">
              {Object.keys(monthTotals).length > 0
                ? fmtCurrency(
                    Object.values(monthTotals).reduce((a, b) => a + b, 0) /
                      Object.keys(monthTotals).length
                  )
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Attachment preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">{previewName}</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              {previewUrl.match(/\.(png|jpg|jpeg|webp|gif)$/i) ? (
                <img
                  src={previewUrl}
                  alt={previewName}
                  className="w-full rounded-lg border border-border"
                />
              ) : previewUrl.match(/\.pdf$/i) ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[500px] rounded-lg border border-border"
                  title={previewName}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Preview not available for this file type.
                </p>
              )}
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-teal hover:underline"
              >
                Open in new tab
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Expense table */}
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          {expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-[oklch(0.95_0.006_90)] border border-border flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 17.5v-11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">No expenses recorded yet</p>
              {isAdmin && (
                <p className="text-[10px] text-[oklch(0.60_0.01_250)] mt-1">
                  Click &quot;Add Expense&quot; to log API costs, infrastructure, etc.
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                  {isAdmin && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((exp) => (
                  <TableRow key={exp.id}>
                    <TableCell className="text-xs font-mono">
                      {new Date(exp.expense_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[9px] ${getCategoryStyle(exp.category)}`}>
                        {getCategoryLabel(exp.category)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{exp.description}</TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {fmtCurrency(exp.amount)}
                    </TableCell>
                    <TableCell>
                      {exp.receipt_url ? (
                        <button
                          onClick={() => {
                            setPreviewUrl(exp.receipt_url);
                            setPreviewName(exp.receipt_filename ?? "Receipt");
                          }}
                          className="inline-flex items-center gap-1.5 text-xs text-teal hover:underline"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                          </svg>
                          {exp.receipt_filename ?? "View"}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <button
                          onClick={() => handleDelete(exp)}
                          disabled={deleting === exp.id}
                          className="text-muted-foreground hover:text-loss transition-colors disabled:opacity-50"
                          title="Delete expense"
                        >
                          {deleting === exp.id ? (
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          )}
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
