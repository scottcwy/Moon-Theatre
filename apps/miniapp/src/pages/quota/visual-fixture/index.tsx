import { View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { PaymentConfirmSheet, PaymentResultPanel } from '@juben-sha/miniapp-ui';
import { CONFIRM_SHEET_FIXTURE, PENDING_RESULT_FIXTURE } from './fixtures';
import './index.scss';

export default function QuotaVisualFixture() {
  const router = useRouter();
  const state = (router.params.state as string) || 'confirm-sheet';

  if (state === 'result-pending') {
    return (
      <View className="visual-fixture visual-fixture--pending">
        <View className="visual-fixture__spacer" />
        <PaymentResultPanel
          tone="pending"
          title={PENDING_RESULT_FIXTURE.title}
          message={PENDING_RESULT_FIXTURE.message}
          primaryText="返回订单"
          secondaryText="返回选购"
          onPrimary={() => undefined}
          onSecondary={() => undefined}
        />
      </View>
    );
  }

  return (
    <View className="visual-fixture visual-fixture--confirm">
      <PaymentConfirmSheet
        visible
        packageName={CONFIRM_SHEET_FIXTURE.packageName}
        points={CONFIRM_SHEET_FIXTURE.points}
        amountCents={CONFIRM_SHEET_FIXTURE.amountCents}
        balanceAfterPoints={CONFIRM_SHEET_FIXTURE.balanceAfterPoints}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    </View>
  );
}

definePageConfig({
  navigationStyle: 'custom',
  backgroundColor: '#8A837B',
  backgroundTextStyle: 'light',
});
