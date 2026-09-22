import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  BellRing, 
  CheckCircle2, 
  AlertTriangle, 
  Smartphone, 
  RefreshCw,
  X
} from 'lucide-react';
import { 
  isPushSupported, 
  getPushPermissionState, 
  getExistingPushSubscription, 
  subscribeToPush, 
  unsubscribeFromPush,
  sendTestPushToSelf
} from '../../lib/pushSubscription';
import { auth } from '../../lib/firebase';

interface SidebarPushNotificationProps {
  role?: string | null;
  onSuccess?: () => void;
}

export const SidebarPushNotification: React.FC<SidebarPushNotificationProps> = ({
  role = 'membro',
  onSuccess
}) => {
  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<string>('default');
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    const isSup = isPushSupported();
    setSupported(isSup);
    if (!isSup) return;

    setPermission(getPushPermissionState());
    const sub = await getExistingPushSubscription();
    setIsSubscribed(!!sub);
  };

  const handleActivate = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setFeedback({ text: 'Faça login para ativar as notificações no aparelho.', type: 'error' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const res = await subscribeToPush({
        user: {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName
        },
        role: role || 'membro'
      });

      if (res.success) {
        setIsSubscribed(true);
        setPermission('granted');
        setFeedback({ 
          text: '✓ Ativado! Agora você receberá os avisos da igreja mesmo com o celular bloqueado ou app fechado.', 
          type: 'success' 
        });
        if (onSuccess) onSuccess();
      } else {
        setPermission(getPushPermissionState());
        setFeedback({ text: res.error || 'Não foi possível ativar. Verifique as permissões.', type: 'error' });
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Erro ao ativar.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setLoading(true);
    try {
      const ok = await unsubscribeFromPush(currentUser.uid);
      if (ok) {
        setIsSubscribed(false);
        setFeedback({ text: 'Notificações no celular desativadas.', type: 'info' });
      }
    } catch (err: any) {
      setFeedback({ text: 'Erro ao desativar.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestNotification = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const sub = await getExistingPushSubscription();
      if (!sub) {
        setFeedback({ text: 'Por favor, ative as notificações primeiro.', type: 'error' });
        setTesting(false);
        return;
      }

      setTestCountdown(5);
      const res = await sendTestPushToSelf(sub, 5);

      if (res.success) {
        setFeedback({
          text: '⏳ Teste agendado! Feche o app ou bloqueie a tela do celular agora. A notificação chegará em 5 segundos.',
          type: 'info'
        });

        let remaining = 5;
        const interval = setInterval(() => {
          remaining -= 1;
          setTestCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(interval);
            setTestCountdown(null);
            setTesting(false);
          }
        }, 1000);
      } else {
        setFeedback({ text: res.message, type: 'error' });
        setTesting(false);
        setTestCountdown(null);
      }
    } catch (err: any) {
      setFeedback({ text: err.message || 'Erro no envio do teste.', type: 'error' });
      setTesting(false);
      setTestCountdown(null);
    }
  };

  if (!supported) return null;

  return (
    <div className="rounded-2xl bg-gradient-to-b from-white/10 to-white/5 border border-church-gold/25 p-3.5 text-white shadow-lg space-y-3">
      {/* Cabeçalho */}
      <div className="flex items-start gap-2.5">
        <div className={`p-2 rounded-xl shrink-0 ${
          isSubscribed 
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
            : permission === 'denied'
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              : 'bg-church-gold/20 text-church-gold border border-church-gold/30'
        }`}>
          {isSubscribed ? <BellRing className="w-5 h-5 animate-pulse" /> : <Bell className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <h4 className="font-serif font-bold text-xs text-white leading-tight">
              Notificações Push no Celular
            </h4>
            {isSubscribed ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded-full shrink-0">
                <CheckCircle2 className="w-2.5 h-2.5" /> Ativo
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-white/70 leading-snug mt-1">
            Receba avisos, cultos, pedidos de oração e comunicados sem precisar entrar no app
          </p>
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="space-y-2 pt-1">
        {!isSubscribed ? (
          <button
            type="button"
            onClick={handleActivate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-church-gold hover:bg-church-gold/90 text-church-navy font-bold text-xs py-2.5 px-3 shadow transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Ativando no celular...</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span>Ativar no Meu Celular</span>
              </>
            )}
          </button>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleTestNotification}
              disabled={testing}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3 shadow transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {testCountdown !== null ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-white" />
                  <span>Feche o app! ({testCountdown}s)</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Testar com App Fechado (5s)</span>
                </>
              )}
            </button>
            <div className="flex items-center justify-between text-[10px] text-white/50 px-1">
              <span>✓ Funciona com tela bloqueada</span>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={loading}
                className="hover:text-rose-300 underline cursor-pointer"
              >
                Desativar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mensagem de Feedback */}
      {feedback && (
        <div className={`p-2 rounded-xl text-[11px] leading-tight flex items-start justify-between gap-1.5 ${
          feedback.type === 'success'
            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
            : feedback.type === 'error'
              ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
              : 'bg-sky-500/20 text-sky-200 border border-sky-500/30'
        }`}>
          <span>{feedback.text}</span>
          <button 
            type="button" 
            onClick={() => setFeedback(null)} 
            className="text-white/60 hover:text-white p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {permission === 'denied' && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-2 text-[10px] text-rose-200 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
          <span>
            Notificações bloqueadas no navegador. Toque no cadeado ao lado do endereço do site e mude &quot;Notificações&quot; para <strong>Permitir</strong>.
          </span>
        </div>
      )}
    </div>
  );
};
