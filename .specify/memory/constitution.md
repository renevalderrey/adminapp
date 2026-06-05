# Project Constitution

This document defines the core principles, standards, and guidelines for developing the `sistema-de-facturacion` project. All specifications, technical plans, and implementation steps generated must strictly adhere to these rules.

## 1. Architecture & Tech Stack

### Backend
- **Framework**: Node.js with Express.js.
- **Database**: PostgreSQL.
- **Pattern**: Modular architecture (Models, Services, Controllers, Routes).

### Frontend
- **Framework**: React via Vite.
- **State Management**: Zustand (Do NOT use Redux or other state management libraries).
- **Styling**: Vanilla CSS (`index.css` as the core file). TailwindCSS should ONLY be used if the developer explicitly requests it.

## 2. Core Domain Constraints (Billing & AFIP/ARCA)
- **Immutability of Fiscal Records**: Financial transactions and AFIP invoices must NOT be deleted. They can only be annulled or reversed through credit notes.
- **AFIP Integration**: All sales operations related to electronic billing must preserve the CAE (Código de Autorización Electrónico) and associated AFIP data in the local database.
- **Multi-tenant SaaS Architecture**: As the system scales to a SaaS model, all queries and creations must filter and associate records by `tenant_id` where applicable.

## 3. UI/UX & Aesthetics
- **Premium Design**: The UI must not look generic or basic. It must feature modern typography (e.g., Inter, Roboto), vibrant but harmonious color palettes, and glassmorphism where appropriate.
- **Dynamic Interfaces**: Include smooth micro-animations and hover effects to make the interface feel alive and responsive.
- **No Placeholders**: Functional demonstrations must be created instead of using empty placeholders in production views.

## 4. Workflows & Agent Guidelines
- **Spec-Driven Process**: All new features must start with `/speckit.specify`, followed by `/speckit.plan`, and `/speckit.tasks` before any code is written (`/speckit.implement`).
- **Validation**: Any plan must account for testing the integration point, especially regarding Auth0 and AFIP/ARCA integrations.
- **Preserve Documentation**: Maintain existing comments and docstrings unless explicitly requested to change them.
