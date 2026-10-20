import { AdminPanel } from "@/components/AdminPanel";
import { SimpleHeader } from "@/components/SimpleHeader";
import { itemCount, reviewerProgress, validateStudyData } from "@/server/admin";
import { requirePageUser } from "@/server/http";
import { getInstrumentConfig, getStudySeed } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { user, db } = await requirePageUser("admin");
  const [reviewers, items, validation, config, seed] = await Promise.all([
    reviewerProgress(db),
    itemCount(db),
    validateStudyData(db),
    getInstrumentConfig(db),
    getStudySeed(db),
  ]);
  return (
    <>
      <SimpleHeader who={`${user.displayName ?? user.reviewerCode} (admin)`} />
      <AdminPanel
        reviewers={reviewers.map((r) => ({
          ...r,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          lastSavedAt: r.lastSavedAt ? new Date(r.lastSavedAt).toISOString() : null,
        }))}
        itemCount={items}
        validation={validation}
        config={config}
        studySeed={seed}
      />
    </>
  );
}
