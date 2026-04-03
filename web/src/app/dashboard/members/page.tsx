"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { MemberSummary, Contribution } from "@/lib/types/trading";

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MembersPage() {
  const supabase = createClient();
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);

  useEffect(() => {
    async function load() {
      const [memRes, contRes] = await Promise.all([
        supabase.from("member_summary").select("*"),
        supabase
          .from("contributions")
          .select("*")
          .order("contributed_at", { ascending: false })
          .limit(50),
      ]);
      if (memRes.data) setMembers(memRes.data);
      if (contRes.data) setContributions(contRes.data);
    }

    load();
  }, []);

  const totalPool = members.reduce((sum, m) => sum + m.total_contributed, 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Members</h2>
        <p className="text-muted-foreground">
          Pool contributions and ownership breakdown
        </p>
      </div>

      {/* Member Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
        {members.map((m) => (
          <Card key={m.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{m.display_name}</CardTitle>
                <Badge
                  variant="outline"
                  className={
                    m.role === "admin"
                      ? "border-teal text-teal"
                      : "border-muted-foreground text-muted-foreground"
                  }
                >
                  {m.role}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {fmtCurrency(m.total_contributed)}
              </p>
              <p className="text-sm text-gold font-medium">
                {m.ownership_pct.toFixed(1)}% of pool
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Wire Instructions */}
      <Card className="border-gold/30">
        <CardHeader>
          <CardTitle className="text-base text-gold">
            Wire Instructions for Deposits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            To add funds to the pool, wire transfer to Jarrett&apos;s IBKR account:
          </p>
          <div className="rounded-md bg-muted p-4 font-mono text-xs space-y-1">
            <p>
              <span className="text-muted-foreground">Bank:</span> Interactive
              Brokers LLC
            </p>
            <p>
              <span className="text-muted-foreground">Account Name:</span>{" "}
              Jarrett Walker
            </p>
            <p>
              <span className="text-muted-foreground">Account #:</span>{" "}
              [CONFIGURED IN SETTINGS]
            </p>
            <p>
              <span className="text-muted-foreground">Routing #:</span>{" "}
              [CONFIGURED IN SETTINGS]
            </p>
            <p>
              <span className="text-muted-foreground">Reference:</span> Your
              name + &quot;Skidaway Pool&quot;
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Notify Jarrett after wiring so your contribution can be recorded.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Contribution History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contribution History</CardTitle>
        </CardHeader>
        <CardContent>
          {contributions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No contributions recorded yet
            </p>
          ) : (
            <div className="overflow-x-auto -mx-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => {
                  const member = members.find((m) => m.id === c.user_id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">
                        {new Date(c.contributed_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-medium">
                        {member?.display_name ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-profit">
                        +{fmtCurrency(c.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.note ?? "--"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
