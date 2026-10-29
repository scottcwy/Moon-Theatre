import confirmFixture from '../../../../e2e/visual-fixtures/second-contract/payment-confirm-sheet.json';
import pendingFixture from '../../../../e2e/visual-fixtures/second-contract/payment-result-pending.json';

export interface ConfirmSheetFixture {
  packageName: string;
  points: number;
  amountCents: number;
  balanceAfterPoints: number;
}

export interface PendingResultFixture {
  title: string;
  message: string;
}

export const CONFIRM_SHEET_FIXTURE: ConfirmSheetFixture = {
  packageName: confirmFixture.package.name,
  points: confirmFixture.package.points,
  amountCents: confirmFixture.package.priceCents,
  balanceAfterPoints: confirmFixture.balanceAfterPoints,
};

export const PENDING_RESULT_FIXTURE: PendingResultFixture = pendingFixture.panel;
