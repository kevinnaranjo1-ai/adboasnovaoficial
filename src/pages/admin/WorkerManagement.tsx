import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, UserPlus, Search, Filter, Mail, Phone, 
  Calendar, CheckCircle2, XCircle, MoreVertical, 
  ChevronRight, ArrowLeft, Loader2, MessageCircle, Users, Award, Shield
} from 'lucide-react';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { format, differenceInYears, differenceInMonths } from 'date-fns';
import { useAuthState } from 'react-firebase-hooks/auth';
import { ptBR } from 'date-fns/locale';
import BirthdayPicker from '../../components/BirthdayPicker';
import DeleteConfirmationModal from '../../components/DeleteConfirmationModal';

interface Worker {
  id: string;
  name: string;
  email?: string;
  whatsapp: string;
  category: string;
  birthDate?: string;
  ministryStartDate?: string;
  isBaptizedInWater: boolean;
  isBaptizedInSpirit: boolean;
  isTither: boolean;
  status: 'active' | 'inactive';
  createdAt: any;
  photoUrl?: string;
  source?: 'worker' | 'member';
  memberId?: string;
  department?: string;
}

interface WorkerManagementProps {
  role: string | null;
}

const MINISTERIAL_ROLES = [
  'pastor', 'pastora', 'presbítero', 'presbitero', 'evangelista', 
  'missionário', 'missionario', 'missionária', 'missionaria', 
  'diácono', 'diacono', 'diaconisa', 'obreiro', 'auxiliar', 
  'líder', 'lider', 'leader', 'secretária', 'secretaria', 
  'tesoureira', 'tesoureiro', 'porteiro zelador', 'apoio'
];

function isMinisterialPosition(position?: string | null, role?: string | null): boolean {
  if (role && MINISTERIAL_ROLES.includes(role.trim().toLowerCase())) {
    return true;
  }
  if (!position) return false;
  const p = position.trim().toLowerCase();
  if (!p || p === 'membro' || p === 'membro geral' || p === 'visitante' || p === 'congregação') {
    return false;
  }
  return true;
}

export default function WorkerManagement({ role }: WorkerManagementProps) {
  const [user] = useAuthState(auth);
  const [rawWorkers, setRawWorkers] = useState<Worker[]>([]);
  const [rawMembers, setRawMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [selectedMemberForNewWorkerId, setSelectedMemberForNewWorkerId] = useState<string>('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [workerToDeleteId, setWorkerToDeleteId] = useState<string | null>(null);
  
  const isPastorAdmin = useMemo(() => {
    return (role && ['admin', 'pastor', 'pastora'].includes(role)) || 
           user?.email?.toLowerCase() === 'kevinnaranjo1@gmail.com';
  }, [role, user]);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    whatsapp: '',
    category: 'Obreiro',
    birthDate: '',
    ministryStartDate: '',
    isBaptizedInWater: false,
    isBaptizedInSpirit: false,
    isTither: false,
    status: 'active' as 'active' | 'inactive'
  });

  // Escuta a coleção workers e a coleção members em tempo real
  useEffect(() => {
    const qWorkers = query(collection(db, 'workers'), orderBy('name', 'asc'));
    const unsubscribeWorkers = onSnapshot(qWorkers, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Worker[];
      setRawWorkers(docs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'workers');
      setLoading(false);
    });

    const qMembers = query(collection(db, 'members'), orderBy('name', 'asc'));
    const unsubscribeMembers = onSnapshot(qMembers, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRawMembers(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'members');
    });

    return () => {
      unsubscribeWorkers();
      unsubscribeMembers();
    };
  }, []);

  // Mescla obreiros da coleção 'workers' com membros que possuem cargo ministerial
  const allWorkers = useMemo(() => {
    const list: Worker[] = rawWorkers.map(w => ({
      ...w,
      source: 'worker' as const
    }));

    rawMembers.forEach(member => {
      const hasMinistryPosition = isMinisterialPosition(member.position, member.role);
      if (!hasMinistryPosition) return;

      const existingIndex = list.findIndex(w => 
        (w.memberId && w.memberId === member.id) ||
        (w.email && member.email && w.email.toLowerCase().trim() === member.email.toLowerCase().trim()) ||
        (w.name.trim().toLowerCase() === member.name.trim().toLowerCase())
      );

      const category = (member.position && member.position.toLowerCase() !== 'membro') 
        ? member.position 
        : (member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : 'Obreiro');

      if (existingIndex >= 0) {
        const current = list[existingIndex];
        list[existingIndex] = {
          ...current,
          memberId: member.id,
          photoUrl: current.photoUrl || member.photoUrl,
          whatsapp: current.whatsapp || member.whatsapp || member.phone || '',
          birthDate: current.birthDate || member.birthDate || '',
          ministryStartDate: current.ministryStartDate || member.conversionDate || '',
          department: member.department || current.department,
          category: current.category || category
        };
      } else {
        list.push({
          id: `member-${member.id}`,
          memberId: member.id,
          name: member.name,
          email: member.email || '',
          whatsapp: member.whatsapp || member.phone || '',
          category: category,
          birthDate: member.birthDate || '',
          ministryStartDate: member.conversionDate || '',
          isBaptizedInWater: Boolean(member.isBaptized),
          isBaptizedInSpirit: Boolean(member.isSpiritBaptized),
          isTither: Boolean(member.isTither),
          status: member.status === 'inactive' ? 'inactive' : 'active',
          createdAt: member.createdAt,
          photoUrl: member.photoUrl,
          department: member.department,
          source: 'member'
        });
      }
    });

    return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [rawWorkers, rawMembers]);

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      whatsapp: '',
      category: 'Obreiro',
      birthDate: '',
      ministryStartDate: '',
      isBaptizedInWater: false,
      isBaptizedInSpirit: false,
      isTither: false,
      status: 'active'
    });
    setSelectedMemberForNewWorkerId('');
    setEditingWorkerId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (worker: Worker) => {
    setFormData({
      name: worker.name,
      email: worker.email || '',
      whatsapp: worker.whatsapp || '',
      category: worker.category || 'Obreiro',
      birthDate: worker.birthDate || '',
      ministryStartDate: worker.ministryStartDate || '',
      isBaptizedInWater: worker.isBaptizedInWater,
      isBaptizedInSpirit: worker.isBaptizedInSpirit,
      isTither: worker.isTither,
      status: worker.status
    });
    setEditingWorkerId(worker.id);
    setIsModalOpen(true);
    setActiveMenuId(null);
  };

  const handleSelectExistingMember = (memberId: string) => {
    setSelectedMemberForNewWorkerId(memberId);
    if (!memberId) return;
    const found = rawMembers.find(m => m.id === memberId);
    if (found) {
      setFormData(prev => ({
        ...prev,
        name: found.name || prev.name,
        email: found.email || prev.email,
        whatsapp: found.whatsapp || found.phone || prev.whatsapp,
        birthDate: found.birthDate || prev.birthDate,
        ministryStartDate: found.conversionDate || prev.ministryStartDate,
        category: (found.position && found.position !== 'Membro') ? found.position : prev.category,
        isBaptizedInWater: Boolean(found.isBaptized),
        isBaptizedInSpirit: Boolean(found.isSpiritBaptized),
        isTither: Boolean(found.isTither),
        status: found.status === 'inactive' ? 'inactive' : 'active'
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const selectedWorker = allWorkers.find(w => w.id === editingWorkerId);

      if (editingWorkerId) {
        if (selectedWorker?.source === 'member' && selectedWorker.memberId) {
          // Atualiza dados no registro de membros
          await updateDoc(doc(db, 'members', selectedWorker.memberId), {
            name: formData.name,
            email: formData.email,
            whatsapp: formData.whatsapp,
            phone: formData.whatsapp,
            position: formData.category,
            birthDate: formData.birthDate,
            conversionDate: formData.ministryStartDate,
            isBaptized: formData.isBaptizedInWater,
            isSpiritBaptized: formData.isBaptizedInSpirit,
            isTither: formData.isTither,
            status: formData.status,
            updatedAt: serverTimestamp()
          });
        } else {
          // Atualiza na coleção de workers
          await updateDoc(doc(db, 'workers', editingWorkerId), {
            ...formData,
            updatedAt: serverTimestamp()
          });
          // Se tiver memberId vinculado, atualiza cargo também no membro
          if (selectedWorker?.memberId) {
            await updateDoc(doc(db, 'members', selectedWorker.memberId), {
              position: formData.category,
              updatedAt: serverTimestamp()
            }).catch(() => {});
          }
        }
      } else {
        // Novo obreiro: adiciona na coleção workers
        await addDoc(collection(db, 'workers'), {
          ...formData,
          memberId: selectedMemberForNewWorkerId || null,
          createdAt: serverTimestamp()
        });

        // Se o obreiro foi selecionado a partir de um membro existente, atualiza o cargo do membro
        if (selectedMemberForNewWorkerId) {
          await updateDoc(doc(db, 'members', selectedMemberForNewWorkerId), {
            position: formData.category,
            updatedAt: serverTimestamp()
          }).catch(() => {});
        }
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, editingWorkerId ? `workers/${editingWorkerId}` : 'workers');
    }
  };

  const handleDeleteWorker = async (id: string) => {
    try {
      const workerToRemove = allWorkers.find(w => w.id === id);
      if (workerToRemove?.source === 'member' && workerToRemove.memberId) {
        // Remove cargo ministerial do membro, voltando a Membro regular
        await updateDoc(doc(db, 'members', workerToRemove.memberId), {
          position: 'Membro',
          updatedAt: serverTimestamp()
        });
      } else {
        await deleteDoc(doc(db, 'workers', id));
      }
      setActiveMenuId(null);
      setWorkerToDeleteId(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `workers/${id}`);
    }
  };

  const getMinistryTime = (date?: string) => {
    if (!date) return 'Não informado';
    try {
      const start = new Date(date);
      if (isNaN(start.getTime())) return 'Não informado';
      const years = differenceInYears(new Date(), start);
      const months = differenceInMonths(new Date(), start) % 12;
      
      if (years === 0 && months === 0) return 'Recente';
      if (years === 0) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
      return `${years} ${years === 1 ? 'ano' : 'anos'}${months > 0 ? ` e ${months} ${months === 1 ? 'mês' : 'meses'}` : ''}`;
    } catch {
      return 'Não informado';
    }
  };

  const filteredWorkers = useMemo(() => {
    return allWorkers.filter(w => {
      const matchesSearch = 
        w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        w.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (w.email && w.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (w.department && w.department.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchesSearch) return false;

      if (selectedCategoryFilter === 'todos') return true;
      const cat = w.category.toLowerCase();
      if (selectedCategoryFilter === 'pastores') return cat.includes('pastor');
      if (selectedCategoryFilter === 'presbiteros') return cat.includes('presb');
      if (selectedCategoryFilter === 'evangelistas') return cat.includes('evang');
      if (selectedCategoryFilter === 'missionarios') return cat.includes('missio');
      if (selectedCategoryFilter === 'diaconos') return cat.includes('diác') || cat.includes('diac');
      if (selectedCategoryFilter === 'obreiros') return cat.includes('obreir') || cat.includes('auxiliar');
      if (selectedCategoryFilter === 'lideranca') return cat.includes('secret') || cat.includes('tesour') || cat.includes('porteir') || cat.includes('apoio') || cat.includes('líder') || cat.includes('lider');

      return true;
    });
  }, [allWorkers, searchTerm, selectedCategoryFilter]);

  const CATEGORY_CHIPS = [
    { id: 'todos', label: 'Todos' },
    { id: 'pastores', label: 'Pastores' },
    { id: 'presbiteros', label: 'Presbíteros' },
    { id: 'evangelistas', label: 'Evangelistas' },
    { id: 'missionarios', label: 'Missionários' },
    { id: 'diaconos', label: 'Diáconos & Diaconisas' },
    { id: 'obreiros', label: 'Obreiros & Auxiliares' },
    { id: 'lideranca', label: 'Liderança & Apoio' },
  ];

  return (
    <div className="space-y-6 p-4 lg:p-8 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-black text-church-navy">Corpo de Obreiros</h1>
            <span className="rounded-full bg-church-navy/10 px-3 py-1 text-xs font-bold text-church-navy">
              {allWorkers.length} {allWorkers.length === 1 ? 'registrado' : 'registrados'}
            </span>
          </div>
          <p className="text-church-navy/60 text-sm mt-1">
            Gestão do ministério, oficiais e pessoas com cargos ministeriais na igreja
          </p>
        </div>
        {isPastorAdmin && (
          <button 
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 rounded-xl bg-church-navy px-6 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            <UserPlus className="h-4 w-4 text-church-gold" /> Novo Obreiro
          </button>
        )}
      </header>

      {/* Barra de Busca e Filtros Rápidos */}
      <div className="space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-church-navy/30" />
            <input 
              type="text"
              placeholder="Buscar por nome, cargo ou e-mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-2xl border border-church-gold/10 bg-white pl-12 pr-4 py-3 placeholder:text-church-navy/20 focus:outline-none focus:ring-2 focus:ring-church-gold/20"
            />
          </div>
        </div>

        {/* Chips de filtro por cargo ministerial */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORY_CHIPS.map(chip => (
            <button
              key={chip.id}
              onClick={() => setSelectedCategoryFilter(chip.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                selectedCategoryFilter === chip.id
                  ? 'bg-church-navy text-white shadow-sm'
                  : 'bg-white border border-church-gold/15 text-church-navy/70 hover:bg-church-navy/5'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-church-gold" />
        </div>
      ) : filteredWorkers.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-church-gold/30 bg-white/50 p-12 text-center">
          <Shield className="mx-auto h-12 w-12 text-church-gold/40" />
          <h3 className="mt-4 font-serif text-lg font-bold text-church-navy">Nenhum obreiro encontrado</h3>
          <p className="mt-1 text-sm text-church-navy/60">
            {searchTerm || selectedCategoryFilter !== 'todos'
              ? 'Tente ajustar os filtros ou termo de busca.' 
              : 'Cadastre um novo obreiro ou atribua um cargo ministerial a um membro.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filteredWorkers.map((worker) => (
              <motion.div
                key={worker.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`group relative rounded-3xl border border-church-gold/10 bg-white p-6 shadow-sm hover:shadow-md transition-all ${activeMenuId === worker.id ? 'z-20' : 'z-0'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-church-navy/5 text-church-navy overflow-hidden border border-church-gold/10">
                    {worker.photoUrl ? (
                      <img 
                        src={worker.photoUrl} 
                        alt={worker.name} 
                        className="h-full w-full object-cover" 
                        referrerPolicy="no-referrer" 
                      />
                    ) : (
                      <ShieldCheck className="h-7 w-7 text-church-navy" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {worker.source === 'member' && (
                      <span className="rounded-full bg-church-gold/15 px-2.5 py-0.5 text-[9px] font-bold text-church-navy tracking-tight">
                        Membro c/ Cargo
                      </span>
                    )}
                    <div className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      worker.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-church-gold/10 text-church-navy/40'
                    }`}>
                      {worker.status === 'active' ? 'Ativo' : 'Inativo'}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-serif text-xl font-black text-church-navy leading-snug">{worker.name}</h3>
                  </div>
                  <div className="flex flex-col gap-1.5 mt-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-church-navy text-[10px] font-bold uppercase py-0.5 px-2 text-white flex items-center gap-1 shadow-sm">
                        <Award className="h-3 w-3 text-church-gold" />
                        {worker.category}
                      </span>
                      {worker.department && (
                        <span className="rounded-md bg-church-gold/10 text-[10px] font-bold text-church-navy py-0.5 px-1.5">
                          {worker.department}
                        </span>
                      )}
                      {worker.birthDate && (
                        <span className="text-[10px] font-bold text-church-navy/40">
                          {differenceInYears(new Date(), new Date(worker.birthDate))} anos
                        </span>
                      )}
                    </div>
                    {worker.email && (
                      <p className="text-[11px] text-church-navy/50 truncate">
                        {worker.email}
                      </p>
                    )}
                    {worker.whatsapp && (
                      <a 
                        href={`https://wa.me/${worker.whatsapp.replace(/\D/g, '')}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-bold text-green-600 hover:underline pt-0.5"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp ({worker.whatsapp})
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-church-navy/30">Tempo no Ministério</p>
                    <p className="text-sm font-bold text-church-navy">{getMinistryTime(worker.ministryStartDate)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-church-navy/30">Batismo Águas</p>
                    <div className="flex items-center gap-1">
                      {worker.isBaptizedInWater ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-church-navy/20" />
                      )}
                      <span className="text-sm font-bold text-church-navy">{worker.isBaptizedInWater ? 'Sim' : 'Não'}</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-church-navy/30">Batismo No Espírito</p>
                    <div className="flex items-center gap-1">
                       <span className={`h-1.5 w-1.5 rounded-full ${worker.isBaptizedInSpirit ? 'bg-church-gold' : 'bg-church-navy/10'}`} />
                       <span className="font-bold text-church-navy">{worker.isBaptizedInSpirit ? 'Sim' : 'Não'}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-church-navy/30">Dizimista</p>
                    <div className="flex items-center gap-1">
                       <span className={`h-1.5 w-1.5 rounded-full ${worker.isTither ? 'bg-green-500' : 'bg-church-navy/10'}`} />
                       <span className="font-bold text-church-navy">{worker.isTither ? 'Sim' : 'Não'}</span>
                    </div>
                  </div>
                </div>

                {isPastorAdmin && (
                  <div className="mt-6 flex items-center justify-between border-t border-church-gold/5 pt-4">
                    <span className="text-xs text-church-navy/40">
                      {worker.createdAt ? `Registrado em ${format(worker.createdAt.toDate ? worker.createdAt.toDate() : new Date(worker.createdAt), 'MM/yyyy')}` : 'Oficial da Igreja'}
                    </span>
                    <div className="relative">
                      <button 
                        onClick={() => setActiveMenuId(activeMenuId === worker.id ? null : worker.id)}
                        className="rounded-lg p-2 hover:bg-church-navy/5 text-church-navy/40 transition-colors"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      {activeMenuId === worker.id && (
                        <div className="absolute bottom-full right-0 mb-2 w-36 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-church-navy/5 z-50">
                          <button 
                            onClick={() => handleOpenEditModal(worker)}
                            className="flex w-full items-center px-4 py-3 text-sm font-bold text-church-navy hover:bg-church-navy/5 transition-colors"
                          >
                            Editar
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setWorkerToDeleteId(worker.id);
                              setActiveMenuId(null);
                            }}
                            className="flex w-full items-center px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors border-t border-church-gold/5"
                          >
                            Remover Cargo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Modal de Adição/Edição */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-church-navy/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
            >
              <div className="bg-church-navy p-6 flex items-center justify-between shrink-0">
                <h2 className="font-serif text-xl font-bold text-white">
                  {editingWorkerId ? 'Editar Obreiro / Cargo Ministerial' : 'Cadastrar Novo Obreiro'}
                </h2>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-white/60 hover:text-white"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6 overflow-y-auto">
                {/* Seleção opcional a partir de membro existente ao criar */}
                {!editingWorkerId && (
                  <div className="p-3.5 bg-church-cream/50 rounded-2xl border border-church-gold/20 space-y-1.5">
                    <label className="text-xs font-bold text-church-navy flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-church-gold" />
                      Puxar dados de um Membro já cadastrado (Opcional):
                    </label>
                    <select
                      value={selectedMemberForNewWorkerId}
                      onChange={(e) => handleSelectExistingMember(e.target.value)}
                      className="w-full rounded-xl border border-church-gold/20 p-2.5 text-xs font-bold text-church-navy bg-white focus:outline-none focus:ring-2 focus:ring-church-gold/20"
                    >
                      <option value="">-- Preencher manualmente ou selecione um membro --</option>
                      {rawMembers.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} {m.position && m.position !== 'Membro' ? `(Cargo Atual: ${m.position})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-church-navy/60">Nome Completo</label>
                    <input 
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full rounded-xl border border-church-gold/20 px-4 py-3 focus:ring-2 focus:ring-church-gold/20 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-church-navy/60">WhatsApp / Telefone</label>
                    <input 
                      required
                      type="tel"
                      placeholder="(00) 00000-0000"
                      value={formData.whatsapp}
                      onChange={(e) => setFormData({...formData, whatsapp: e.target.value})}
                      className="w-full rounded-xl border border-church-gold/20 px-4 py-3 focus:ring-2 focus:ring-church-gold/20 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-church-navy/60">Categoria / Cargo Ministerial</label>
                    <select 
                      value={formData.category}
                      onChange={(e) => setFormData({...formData, category: e.target.value})}
                      className="w-full rounded-xl border border-church-gold/20 px-4 py-3 font-bold text-church-navy focus:ring-2 focus:ring-church-gold/20 outline-none h-[50px] appearance-none"
                    >
                      <option value="Pastor">Pastor</option>
                      <option value="Pastora">Pastora</option>
                      <option value="Evangelista">Evangelista</option>
                      <option value="Missionário">Missionário</option>
                      <option value="Missionária">Missionária</option>
                      <option value="Presbítero">Presbítero</option>
                      <option value="Diácono">Diácono</option>
                      <option value="Diaconisa">Diaconisa</option>
                      <option value="Obreiro">Obreiro</option>
                      <option value="Auxiliar">Auxiliar</option>
                      <option value="Secretária">Secretária</option>
                      <option value="Tesoureira">Tesoureira</option>
                      <option value="Porteiro Zelador">Porteiro Zelador</option>
                      <option value="Apoio">Apoio</option>
                    </select>
                  </div>
                  <BirthdayPicker 
                    label="Data de Nascimento"
                    value={formData.birthDate || ''}
                    onChange={(val) => setFormData({...formData, birthDate: val})}
                  />
                  <BirthdayPicker 
                    label="Início no Ministério / Conversão"
                    value={formData.ministryStartDate || ''}
                    onChange={(val) => setFormData({...formData, ministryStartDate: val})}
                  />
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-church-navy/60">E-mail (Opcional)</label>
                    <input 
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full rounded-xl border border-church-gold/20 px-4 py-3 focus:ring-2 focus:ring-church-gold/20 outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <label className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl border border-church-gold/10 bg-church-cream/30 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={formData.isBaptizedInWater}
                      onChange={(e) => setFormData({...formData, isBaptizedInWater: e.target.checked})}
                      className="h-5 w-5 rounded border-church-gold text-church-navy focus:ring-church-gold"
                    />
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-church-navy">Batizado Águas</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl border border-church-gold/10 bg-church-cream/30 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={formData.isBaptizedInSpirit}
                      onChange={(e) => setFormData({...formData, isBaptizedInSpirit: e.target.checked})}
                      className="h-5 w-5 rounded border-church-gold text-church-navy focus:ring-church-gold"
                    />
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-church-navy text-balance leading-tight">Batismo No Espírito</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl border border-church-gold/10 bg-church-cream/30 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={formData.isTither}
                      onChange={(e) => setFormData({...formData, isTither: e.target.checked})}
                      className="h-5 w-5 rounded border-church-gold text-church-navy focus:ring-church-gold"
                    />
                    <span className="text-[10px] sm:text-xs font-bold uppercase text-church-navy text-balance leading-tight">Dizimista</span>
                  </label>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-church-navy/40">Status</label>
                    <select 
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                      className="w-full rounded-xl border border-church-gold/20 px-2 py-2 text-xs font-bold"
                    >
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 sm:pt-6">
                  <button 
                    type="submit"
                    className="w-full rounded-2xl bg-church-navy py-4 font-black uppercase tracking-widest text-white shadow-xl transition-all hover:bg-church-navy/90 active:scale-95"
                  >
                    {editingWorkerId ? 'Salvar Alterações' : 'Confirmar Cadastro'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <DeleteConfirmationModal
        isOpen={workerToDeleteId !== null}
        onClose={() => setWorkerToDeleteId(null)}
        onConfirm={async () => {
          if (workerToDeleteId) {
            await handleDeleteWorker(workerToDeleteId);
          }
        }}
        title="Remover do Corpo de Obreiros"
        message="Tem certeza que deseja remover esta pessoa do corpo de obreiros? Se ela for um membro cadastrado, seu registro continuará como membro regular da igreja."
      />
    </div>
  );
}

