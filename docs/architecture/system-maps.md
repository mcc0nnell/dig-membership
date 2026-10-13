# DIG Nexus — system maps

Editable Mermaid sources for the [systems atlas](../../demo/atlas.html) and the [offline member demo](../../demo/offline.html). GitHub renders these diagrams directly in Markdown. Each diagram is a **design and development map**, not evidence that a feature is live.

> Runtime target: **Docker Compose + Caddy + Node API + Neon PostgreSQL**. WordPress is an experience layer, not a privileged gateway or system of record. No Salesforce or Twenty dependency is required.

## 1. Container runtime and integration edges

\`\`\`mermaid
flowchart LR
  subgraph UX["Experience layer"]
    W["WordPress / DIG website"]
    O["Organizer console<br/>(guarded development)"]
  end
  subgraph HOST["Docker Compose deployment"]
    C["Caddy / HTTPS"]
    A["DIG Nexus Node API"]
    C --> A
  end
  subgraph DATA["State and policy"]
    N[("Neon PostgreSQL<br/>members · events · consent")]
  end
  W --> C
  O --> C
  A -->|"authorized transactions"| N
  G["Google OIDC<br/>(development)"] -. "browser identity" .-> A
  L["Magic links<br/>(development)"] -. "email identity" .-> A
  Z["Zeffy hosted checkout"] -->|"signed payment events"| A
  A -. "delivery gated" .-> M["MailerSend adapter"]
  classDef core fill:#155976,color:#fff,stroke:#46e3c5,stroke-width:2px
  classDef edge fill:#233e58,color:#fff,stroke:#90c2cf
  class C,A,N core
  class W,O,G,L,Z,M edge
\`\`\`

**Reading guide:** Solid lines show architectural dependencies or trust boundaries; dashed lines indicate gated integration paths, *not production availability*. Signed webhook authentication does not itself establish a seat, payment reconciliation or admission.

## 2. Identity, enrollment, consent and governance

\`\`\`mermaid
flowchart TB
  I["Verified identity"] --> P["Pending member enrollment"]
  P --> APPROVE{"Authorized policy<br/>approval?"}
  APPROVE -->|yes| MEMBER["Active membership"]
  APPROVE -->|no / not yet| P
  MEMBER --> ELIG["Eligible voter snapshot<br/>not a ballot system"]
  CONSENT["Explicit newsletter opt-in"] --> SUB["Mail subscription eligibility"]
  DIRECTORY["Separate directory opt-in"] --> LIST["Directory entry<br/>(scoped by policy)"]
  ACCESS["Accessibility / accommodation request"] --> STAFF["Restricted event coordinators"]
  classDef member fill:#155976,color:#fff,stroke:#46e3c5,stroke-width:2px
  classDef private fill:#4a385b,color:#fff,stroke:#efca83,stroke-width:2px
  class I,P,APPROVE,MEMBER,ELIG member
  class CONSENT,SUB,DIRECTORY,LIST,ACCESS,STAFF private
\`\`\`

**No automatic edges:** sign-in does not approve membership, subscribe someone to communications, publish them in a directory, or authorize a binding vote. Real ballot casting/counting does not exist in Nexus.

## 3. Conference ticket and payment reconciliation

\`\`\`mermaid
sequenceDiagram
  autonumber
  actor Attendee
  participant Nexus as DIG Nexus API
  participant Neon as Neon PostgreSQL
  participant Zeffy as Zeffy hosted checkout
  participant Staff as Authorized organizer
  Note over Attendee,Staff: Conceptual staging contract; live sales and expiry jobs disabled
  Attendee->>Nexus: Register independently of membership
  Nexus->>Neon: Create expiring non-holding payment request
  Nexus-->>Attendee: Hosted payment instructions
  Attendee->>Zeffy: Complete payment outside Nexus
  Zeffy-->>Nexus: Signed payment notification
  Nexus->>Neon: Reconcile receipt; idempotent seat claim
  alt verified purchase and seat available
    Neon-->>Nexus: Confirm paid admission
    Nexus-->>Attendee: Verified confirmation / scoped QR
  else late, mismatch, refund or capacity conflict
    Neon-->>Nexus: Restricted manual review
    Nexus-->>Staff: Review outcome without leaking sensitive data
  end
\`\`\`

**Important:** A Zeffy checkout success screen does not grant admission. Nexus must independently validate provider evidence and atomic inventory allocation; otherwise staff review is required. No card details or accommodation details belong in QR payloads.

## 4. What the visualization is and is not

- [Systems atlas](../../demo/atlas.html) combines Mermaid rendering with two ECharts charts. It loads pinned third-party visualization code from a CDN and requires connectivity; chart values are invented fixtures.
- [Offline demo](../../demo/offline.html) remains a single file with **no external scripts, network requests, storage, or real member data**.
- Browser charts have explicit table equivalents and textual diagram sources. Keyboard navigation, screen readers, reduced-motion preference and mobile layouts still require manual accessibility review.
- This document describes current intended boundaries, not deployment proof. Consult the [implementation status](../../nexus/IMPLEMENTATION-STATUS.md), [paid inventory](../../nexus/PAID-INVENTORY.md), and [Docker runbook](../../nexus/DOCKER.md) for feature gates and validation procedures.
