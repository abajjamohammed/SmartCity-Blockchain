import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import * as XLSX from "xlsx";
import {
  LOCAL_CONTRACT_ADDRESS,
  SEPOLIA_CONTRACT_ADDRESS,
  CONTRACT_ABI
} from "./ContractConfig";

const STATUS_LABELS = ["Reported", "Assigned", "InProgress", "Resolved", "Closed"];
const STATUS_STYLES = {
  0: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" }, // Reported
  1: { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" }, // Assigned
  2: { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd" }, // InProgress
  3: { bg: "#dcfce7", color: "#166534", border: "#86efac" }, // Resolved
  4: { bg: "#e2e8f0", color: "#334155", border: "#cbd5e1" }, // Closed
};
const VALID_PRIORITIES = ["Low", "Medium", "High", "Critical"];
const VALID_STATUS_MAP = { Reported: 0, Assigned: 1, InProgress: 2, Resolved: 3, Closed: 4 };

export default function App() {
  const [account, setAccount] = useState(null);
  const [isLocalMode, setIsLocalMode] = useState(true);
  const [localSignerIndex, setLocalSignerIndex] = useState(0); // 0 = Municipalité, 1 = Citoyen
  const [isMunicipality, setIsMunicipality] = useState(false);
  const [activeTab, setActiveTab] = useState("citizen"); // citizen | municipality | excel | public

  // Données chargées on-chain
  const [issues, setIssues] = useState([]);
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Formulaire Citoyen
  const [citizenForm, setCitizenForm] = useState({
    issueId: "CITY-2026-101",
    issueType: "StreetLight",
    location: "",
    description: "",
    reportDate: new Date().toISOString().split("T")[0],
    priority: "High",
    reportedBy: "Citizen01"
  });

  // Actions Municipalité
  const [selectedManageId, setSelectedManageId] = useState("");
  const [teamInput, setTeamInput] = useState("UrbanTeam01");
  const [teamComment, setTeamComment] = useState("");
  const [nextStatusInput, setNextStatusInput] = useState("2");
  const [statusComment, setStatusComment] = useState("");

  // Import Excel
  const [excelRows, setExcelRows] = useState([]); // { data, valid, errors, selected }
  const [fileName, setFileName] = useState("");

  // Consultation Publique & Historique
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectedIssue, setInspectedIssue] = useState(null);
  const [inspectedHistory, setInspectedHistory] = useState([]);

  // Statuts & Alertes
  const [alertBox, setAlertBox] = useState({ message: "", type: "" });
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);

  const activeAddress = isLocalMode || !SEPOLIA_CONTRACT_ADDRESS
    ? LOCAL_CONTRACT_ADDRESS
    : SEPOLIA_CONTRACT_ADDRESS;

  function getReadProvider() {
    if (isLocalMode || !window.ethereum) {
      return new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    }
    return new ethers.BrowserProvider(window.ethereum);
  }

  async function getSigner() {
    if (isLocalMode || !window.ethereum) {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      return await provider.getSigner(localSignerIndex);
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }

  function parseError(err) {
    if (err?.code === "ACTION_REJECTED") return "Transaction annulée dans MetaMask.";
    if (err?.revert?.name === "AccessControlUnauthorizedAccount" || err?.message?.includes("AccessControlUnauthorizedAccount")) {
      return "Accès refusé : ce compte n'a pas le rôle MUNICIPALITY_ROLE (réservé aux agents municipaux).";
    }
    return err?.reason || err?.shortMessage || err?.message || "Erreur inconnue";
  }

  // Charger tous les signalements depuis la blockchain
  async function loadIssues(addr = activeAddress, local = isLocalMode) {
    try {
      const provider = local || !window.ethereum
        ? new ethers.JsonRpcProvider("http://127.0.0.1:8545")
        : new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(addr, CONTRACT_ABI, provider);
      const rawList = await contract.getAllIssues();

      const formatted = rawList.map((item) => ({
        id: Number(item.id),
        issueId: item.issueId,
        issueType: item.issueType,
        location: item.location,
        description: item.description,
        reportDate: item.reportDate,
        priority: item.priority,
        reportedBy: item.reportedBy,
        assignedTo: item.assignedTo,
        status: Number(item.status),
        reporterWallet: item.reporterWallet,
        createdAt: Number(item.createdAt),
        updatedAt: Number(item.updatedAt),
      }));

      setIssues(formatted);
      if (formatted.length > 0 && !selectedManageId) {
        setSelectedManageId(String(formatted[0].id));
      }
    } catch {
      // Nœud non démarré ou contrat non déployé
    }
  }

  async function checkRole(userAddr, provider, contractAddr) {
    try {
      const contract = new ethers.Contract(contractAddr, CONTRACT_ABI, provider);
      const roleHash = await contract.MUNICIPALITY_ROLE();
      const has = await contract.hasRole(roleHash, userAddr);
      setIsMunicipality(has);
      return has;
    } catch {
      setIsMunicipality(false);
      return false;
    }
  }

  // Connexion MetaMask (Recommandée dans l'énoncé)
  async function connectMetaMask() {
    if (!window.ethereum) return alert("Veuillez installer l'extension MetaMask !");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      const useLocal = Number(network.chainId) === 31337 || !SEPOLIA_CONTRACT_ADDRESS;
      const addr = useLocal ? LOCAL_CONTRACT_ADDRESS : SEPOLIA_CONTRACT_ADDRESS;

      const signer = await provider.getSigner();
      const userAddr = await signer.getAddress();
      setAccount(userAddr);
      setIsLocalMode(false);
      const hasRole = await checkRole(userAddr, provider, addr);
      await loadIssues(addr, false);

      setAlertBox({
        message: `MetaMask connecté (${userAddr.slice(0, 6)}...${userAddr.slice(-4)}) — Profil : ${hasRole ? "Agent Municipal (MUNICIPALITY_ROLE)" : "Citoyen"}`,
        type: "success"
      });
    } catch (err) {
      setAlertBox({ message: "Erreur MetaMask : " + parseError(err), type: "error" });
    }
  }

  // Connexion rapide nœud local Hardhat (pour basculer facilement Municipalité #0 / Citoyen #1)
  async function connectLocalHardhat(idx = 0) {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const signer = await provider.getSigner(idx);
      const userAddr = await signer.getAddress();
      setAccount(userAddr);
      setIsLocalMode(true);
      setLocalSignerIndex(idx);
      const hasRole = await checkRole(userAddr, provider, LOCAL_CONTRACT_ADDRESS);
      await loadIssues(LOCAL_CONTRACT_ADDRESS, true);

      setAlertBox({
        message: `Mode Hardhat Local (Compte #${idx}) — Profil : ${hasRole ? "Agent Municipal" : "Citoyen"}`,
        type: "success"
      });
    } catch {
      setAlertBox({ message: "Impossible de joindre Hardhat sur 127.0.0.1:8545. Vérifiez 'npx hardhat node'.", type: "error" });
    }
  }

  useEffect(() => {
    loadIssues(LOCAL_CONTRACT_ADDRESS, true);
  }, []);

  // 1. Déclaration Citoyen
  async function handleCitizenReport(e) {
    e.preventDefault();
    if (!account) return alert("Connectez d'abord votre wallet (MetaMask ou Local) !");

    setLoading(true);
    setTxHash("");
    setAlertBox({ message: "Enregistrement du signalement sur la Blockchain...", type: "info" });

    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.reportIssue(
        citizenForm.issueId.trim(),
        citizenForm.issueType,
        citizenForm.location.trim(),
        citizenForm.description.trim(),
        citizenForm.reportDate,
        citizenForm.priority,
        citizenForm.reportedBy.trim()
      );
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setAlertBox({ message: `Signalement ${citizenForm.issueId} enregistré avec succès sur la Blockchain !`, type: "success" });

      const nextNum = issues.length + 102;
      setCitizenForm({
        ...citizenForm,
        issueId: `CITY-2026-${nextNum}`,
        location: "",
        description: ""
      });
      await loadIssues();
    } catch (err) {
      setAlertBox({ message: "Échec : " + parseError(err), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  // 2. Affecter une équipe (Municipalité)
  async function handleAssignTeam(e) {
    e.preventDefault();
    if (!account) return alert("Connectez un wallet !");
    if (!selectedManageId) return;

    setLoading(true);
    setTxHash("");
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.assignTeam(
        Number(selectedManageId),
        teamInput.trim(),
        teamComment.trim() || `Affectation de l'équipe ${teamInput.trim()}`
      );
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setAlertBox({ message: `Équipe "${teamInput}" affectée au signalement #${selectedManageId}.`, type: "success" });
      setTeamComment("");
      await loadIssues();
    } catch (err) {
      setAlertBox({ message: "Échec affectation : " + parseError(err), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  // 3. Mettre à jour le statut (Municipalité)
  async function handleUpdateStatus(e) {
    e.preventDefault();
    if (!account) return alert("Connectez un wallet !");
    if (!selectedManageId) return;

    setLoading(true);
    setTxHash("");
    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.updateIssueStatus(
        Number(selectedManageId),
        Number(nextStatusInput),
        statusComment.trim()
      );
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setAlertBox({
        message: `Statut du signalement #${selectedManageId} mis à jour vers "${STATUS_LABELS[Number(nextStatusInput)]}".`,
        type: "success"
      });
      setStatusComment("");
      await loadIssues();
    } catch (err) {
      setAlertBox({ message: "Échec mise à jour : " + parseError(err), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  // 4. Import Excel + Validation stricte des champs côté client (Partie 3)
  async function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws);

        if (raw.length === 0) {
          alert("Le fichier Excel est vide !");
          return;
        }

        const provider = getReadProvider();
        const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, provider);
        const seenCodes = new Set();

        const validated = await Promise.all(raw.map(async (row) => {
          const errors = [];
          const issueId = String(row.issueId || "").trim();
          const issueType = String(row.issueType || "").trim();
          const location = String(row.location || "").trim();
          const description = String(row.description || "").trim();
          const reportDate = String(row.reportDate || "").trim();
          const priority = String(row.priority || "").trim();
          const reportedBy = String(row.reportedBy || "").trim();
          const assignedTo = String(row.assignedTo || "").trim();
          const statusStr = String(row.status || "Reported").trim();

          if (!issueId) errors.push("issueId manquant");
          if (!issueType) errors.push("issueType manquant");
          if (!location) errors.push("location manquante");
          if (!description) errors.push("description manquante");
          if (!reportDate) errors.push("reportDate manquante");
          if (!VALID_PRIORITIES.includes(priority)) errors.push(`priority invalide (${priority})`);
          if (!reportedBy) errors.push("reportedBy manquant");
          if (VALID_STATUS_MAP[statusStr] === undefined) errors.push(`status invalide (${statusStr})`);

          if (issueId) {
            if (seenCodes.has(issueId)) {
              errors.push("Doublon dans le fichier");
            } else {
              seenCodes.add(issueId);
              try {
                const exists = await contract.issueCodeExists(issueId);
                if (exists) errors.push("Déjà présent sur Blockchain");
              } catch {}
            }
          }

          const valid = errors.length === 0;
          return {
            data: { issueId, issueType, location, description, reportDate, priority, reportedBy, assignedTo, statusStr },
            valid,
            errors,
            selected: valid
          };
        }));

        setExcelRows(validated);
        const validCount = validated.filter(r => r.valid).length;
        setAlertBox({
          message: `Fichier "${file.name}" analysé : ${validCount}/${validated.length} ligne(s) valide(s) prête(s) pour la blockchain.`,
          type: validCount > 0 ? "success" : "error"
        });
      } catch (err) {
        alert("Erreur lecture Excel : " + err.message);
      }
    };
    reader.readAsBinaryString(file);
  }

  function toggleExcelRow(idx) {
    setExcelRows(prev => prev.map((r, i) => i === idx && r.valid ? { ...r, selected: !r.selected } : r));
  }

  async function handleBatchImport() {
    if (!account) return alert("Connectez un wallet municipal !");
    const toImport = excelRows.filter(r => r.valid && r.selected);
    if (toImport.length === 0) return alert("Aucune ligne valide sélectionnée !");

    setLoading(true);
    setTxHash("");
    setAlertBox({ message: `Import de ${toImport.length} signalement(s) sur la Blockchain...`, type: "info" });

    try {
      const signer = await getSigner();
      const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, signer);

      const inputs = toImport.map(({ data }) => ({
        issueId: data.issueId,
        issueType: data.issueType,
        location: data.location,
        description: data.description,
        reportDate: data.reportDate,
        priority: data.priority,
        reportedBy: data.reportedBy,
        assignedTo: data.assignedTo,
        status: VALID_STATUS_MAP[data.statusStr] ?? 0
      }));

      const tx = await contract.batchImportIssues(inputs);
      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setAlertBox({ message: `Succès : ${toImport.length} signalements importés sur la Blockchain !`, type: "success" });

      setExcelRows([]);
      setFileName("");
      await loadIssues();
    } catch (err) {
      setAlertBox({ message: "Échec import Excel : " + parseError(err), type: "error" });
    } finally {
      setLoading(false);
    }
  }

  // 5. Consultation publique + Historique (Partie 4)
  async function inspectIssue(idOrCode) {
    setAlertBox({ message: "", type: "" });
    try {
      const provider = getReadProvider();
      const contract = new ethers.Contract(activeAddress, CONTRACT_ABI, provider);

      let issueStruct;
      if (/^\d+$/.test(String(idOrCode).trim())) {
        issueStruct = await contract.getIssue(Number(idOrCode));
      } else {
        issueStruct = await contract.getIssueByCode(String(idOrCode).trim());
      }

      const numericId = Number(issueStruct.id);
      const rawHist = await contract.getIssueHistory(numericId);

      setInspectedIssue({
        id: numericId,
        issueId: issueStruct.issueId,
        issueType: issueStruct.issueType,
        location: issueStruct.location,
        description: issueStruct.description,
        reportDate: issueStruct.reportDate,
        priority: issueStruct.priority,
        reportedBy: issueStruct.reportedBy,
        assignedTo: issueStruct.assignedTo,
        status: Number(issueStruct.status),
        reporterWallet: issueStruct.reporterWallet,
        createdAt: Number(issueStruct.createdAt),
        updatedAt: Number(issueStruct.updatedAt),
      });

      setInspectedHistory(rawHist.map(h => ({
        timestamp: Number(h.timestamp),
        status: Number(h.status),
        assignedTo: h.assignedTo,
        comment: h.comment,
        updatedBy: h.updatedBy,
      })));
    } catch (err) {
      setInspectedIssue(null);
      setInspectedHistory([]);
      setAlertBox({ message: "Signalement introuvable : " + parseError(err), type: "error" });
    }
  }

  const filteredIssues = statusFilter === "ALL"
    ? issues
    : issues.filter(i => i.status === Number(statusFilter));

  return (
    <div style={ui.wrapper}>
      <div style={ui.container}>

        {/* HEADER */}
        <header style={ui.header}>
          <div>
            <div style={ui.badgeTop}>Smart City · Services Urbains Décentralisés</div>
            <h1 style={ui.title}>UrbanIssueRegistry DApp</h1>
            <p style={ui.subtitle}>Signalement citoyen, suivi municipal & traçabilité immuable sur Blockchain</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {account ? (
                <div style={ui.walletChip}>
                  <span style={{ ...ui.dot, background: isMunicipality ? "#16a34a" : "#0284c7" }} />
                  <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
                  <span style={{
                    fontSize: "11px", padding: "2px 7px", borderRadius: "4px", fontWeight: 700,
                    background: isMunicipality ? "#dcfce7" : "#e0f2fe",
                    color: isMunicipality ? "#166534" : "#075985"
                  }}>
                    {isMunicipality ? "MUNICIPALITÉ" : "CITOYEN"}
                  </span>
                </div>
              ) : (
                <>
                  <button onClick={() => connectLocalHardhat(0)} style={{ ...ui.btn, background: "#0f172a" }}>
                    Hardhat Local
                  </button>
                  <button onClick={connectMetaMask} style={{ ...ui.btn, background: "#0284c7" }}>
                    Connecter MetaMask
                  </button>
                </>
              )}
            </div>

            {account && isLocalMode && (
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => connectLocalHardhat(0)} style={ui.miniBtn}>
                  Compte #0 (Municipalité)
                </button>
                <button onClick={() => connectLocalHardhat(1)} style={ui.miniBtn}>
                  Compte #1 (Citoyen)
                </button>
                <button onClick={connectMetaMask} style={{ ...ui.miniBtn, background: "#dbeafe", color: "#1e40af" }}>
                  Passer sur MetaMask
                </button>
              </div>
            )}
          </div>
        </header>

        {/* NAVIGATION */}
        <div style={ui.tabs}>
          {[
            { id: "citizen", label: "1. Espace Citoyen" },
            { id: "municipality", label: `2. Municipalité (${issues.length})` },
            { id: "excel", label: "3. Import Excel" },
            { id: "public", label: "4. Consultation & Historique" }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{ ...ui.tab, ...(activeTab === t.id ? ui.tabActive : ui.tabInactive) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ALERTE GLOBALE */}
        {alertBox.message && (
          <div style={{
            ...ui.alert,
            background: alertBox.type === "error" ? "#fef2f2" : alertBox.type === "success" ? "#f0fdf4" : "#eff6ff",
            borderColor: alertBox.type === "error" ? "#fca5a5" : alertBox.type === "success" ? "#86efac" : "#bfdbfe",
            color: alertBox.type === "error" ? "#991b1b" : alertBox.type === "success" ? "#166534" : "#1e40af"
          }}>
            <div style={{ fontWeight: 600 }}>{alertBox.message}</div>
            {txHash && <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "4px" }}>Hash Tx : {txHash}</div>}
          </div>
        )}

        {/* ==================== 1. ESPACE CITOYEN ==================== */}
        {activeTab === "citizen" && (
          <div style={ui.card}>
            <div style={ui.cardHeader}>
              <h2 style={ui.cardTitle}>Déclarer un problème urbain</h2>
              <span style={ui.tag}>Tout citoyen connecté</span>
            </div>

            <form onSubmit={handleCitizenReport} style={ui.gridTwo}>
              <div style={ui.formGroup}>
                <label style={ui.label}>Identifiant Signalement (issueId) *</label>
                <input
                  type="text"
                  value={citizenForm.issueId}
                  onChange={e => setCitizenForm({ ...citizenForm, issueId: e.target.value })}
                  required
                  style={ui.input}
                />
              </div>
              <div style={ui.formGroup}>
                <label style={ui.label}>Type de problème *</label>
                <select
                  value={citizenForm.issueType}
                  onChange={e => setCitizenForm({ ...citizenForm, issueType: e.target.value })}
                  style={ui.input}
                >
                  <option value="StreetLight">StreetLight (Éclairage public)</option>
                  <option value="RoadDamage">RoadDamage (Voirie / Nid de poule)</option>
                  <option value="Waste">Waste (Déchets / Propreté)</option>
                  <option value="WaterLeak">WaterLeak (Fuite d'eau)</option>
                  <option value="TrafficSignal">TrafficSignal (Feu tricolore)</option>
                </select>
              </div>

              <div style={ui.formGroup}>
                <label style={ui.label}>Localisation *</label>
                <input
                  type="text"
                  placeholder="ex: Avenue Mohammed V"
                  value={citizenForm.location}
                  onChange={e => setCitizenForm({ ...citizenForm, location: e.target.value })}
                  required
                  style={ui.input}
                />
              </div>
              <div style={ui.formGroup}>
                <label style={ui.label}>Date du constat *</label>
                <input
                  type="date"
                  value={citizenForm.reportDate}
                  onChange={e => setCitizenForm({ ...citizenForm, reportDate: e.target.value })}
                  required
                  style={ui.input}
                />
              </div>

              <div style={ui.formGroup}>
                <label style={ui.label}>Priorité *</label>
                <select
                  value={citizenForm.priority}
                  onChange={e => setCitizenForm({ ...citizenForm, priority: e.target.value })}
                  style={ui.input}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
              <div style={ui.formGroup}>
                <label style={ui.label}>Pseudonyme déclarant (aucune donnée sensible) *</label>
                <input
                  type="text"
                  placeholder="ex: Citizen01"
                  value={citizenForm.reportedBy}
                  onChange={e => setCitizenForm({ ...citizenForm, reportedBy: e.target.value })}
                  required
                  style={ui.input}
                />
              </div>

              <div style={{ ...ui.formGroup, gridColumn: "span 2" }}>
                <label style={ui.label}>Description du problème *</label>
                <textarea
                  rows="3"
                  placeholder="ex: Lampadaire en panne devant l'école depuis 2 jours"
                  value={citizenForm.description}
                  onChange={e => setCitizenForm({ ...citizenForm, description: e.target.value })}
                  required
                  style={ui.input}
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <button type="submit" disabled={loading} style={{ ...ui.btnFull, background: "#0284c7" }}>
                  {loading ? "Envoi sur la Blockchain..." : "Envoyer le Signalement"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ==================== 2. ESPACE MUNICIPALITÉ ==================== */}
        {activeTab === "municipality" && (
          <div>
            {account && !isMunicipality && (
              <div style={{ ...ui.alert, background: "#fff7ed", borderColor: "#fdba74", color: "#9a3412" }}>
                Ce wallet est connecté en tant que <strong>Citoyen</strong>. Les actions d'affectation et de mise à jour de statut sont protégées par <code>MUNICIPALITY_ROLE</code>.
              </div>
            )}

            <div style={ui.gridTwo}>
              {/* Affectation Équipe */}
              <div style={ui.card}>
                <h2 style={{ ...ui.cardTitle, marginBottom: "14px" }}>Affecter une équipe</h2>
                <form onSubmit={handleAssignTeam} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Signalement cible</label>
                    <select
                      value={selectedManageId}
                      onChange={e => setSelectedManageId(e.target.value)}
                      style={ui.input}
                      required
                    >
                      <option value="">-- Choisir --</option>
                      {issues.map(iss => (
                        <option key={iss.id} value={iss.id}>
                          #{iss.id} [{iss.issueId}] — {iss.issueType} ({STATUS_LABELS[iss.status]})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Équipe d'intervention *</label>
                    <input
                      type="text"
                      placeholder="ex: UrbanTeam01"
                      value={teamInput}
                      onChange={e => setTeamInput(e.target.value)}
                      required
                      style={ui.input}
                    />
                  </div>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Commentaire (optionnel)</label>
                    <input
                      type="text"
                      placeholder="ex: Équipe dépêchée sur place"
                      value={teamComment}
                      onChange={e => setTeamComment(e.target.value)}
                      style={ui.input}
                    />
                  </div>
                  <button type="submit" disabled={loading || issues.length === 0} style={{ ...ui.btnFull, background: "#0f172a" }}>
                    Affecter l'équipe
                  </button>
                </form>
              </div>

              {/* Mise à jour Statut */}
              <div style={ui.card}>
                <h2 style={{ ...ui.cardTitle, marginBottom: "14px" }}>Mettre à jour le statut</h2>
                <form onSubmit={handleUpdateStatus} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Signalement cible</label>
                    <select
                      value={selectedManageId}
                      onChange={e => setSelectedManageId(e.target.value)}
                      style={ui.input}
                      required
                    >
                      <option value="">-- Choisir --</option>
                      {issues.map(iss => (
                        <option key={iss.id} value={iss.id}>
                          #{iss.id} [{iss.issueId}] — {STATUS_LABELS[iss.status]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Nouveau statut *</label>
                    <select
                      value={nextStatusInput}
                      onChange={e => setNextStatusInput(e.target.value)}
                      style={ui.input}
                    >
                      <option value="1">Assigned</option>
                      <option value="2">InProgress</option>
                      <option value="3">Resolved</option>
                      <option value="4">Closed</option>
                    </select>
                  </div>
                  <div style={ui.formGroup}>
                    <label style={ui.label}>Commentaire d'intervention *</label>
                    <input
                      type="text"
                      placeholder="ex: Remplacement de l'ampoule effectué"
                      value={statusComment}
                      onChange={e => setStatusComment(e.target.value)}
                      required
                      style={ui.input}
                    />
                  </div>
                  <button type="submit" disabled={loading || issues.length === 0} style={{ ...ui.btnFull, background: "#16a34a" }}>
                    Enregistrer le nouveau statut
                  </button>
                </form>
              </div>
            </div>

            {/* Tableau Municipal */}
            <div style={ui.card}>
              <div style={ui.cardHeader}>
                <h2 style={ui.cardTitle}>Registre des signalements ({filteredIssues.length})</h2>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...ui.input, width: "auto" }}>
                  <option value="ALL">Tous les statuts</option>
                  {STATUS_LABELS.map((lbl, idx) => <option key={lbl} value={idx}>{lbl}</option>)}
                </select>
              </div>

              <div style={ui.tableWrapper}>
                <table style={ui.table}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Code</th>
                      <th>Type & Lieu</th>
                      <th>Priorité</th>
                      <th>Équipe</th>
                      <th>Statut</th>
                      <th>Historique</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.map(iss => {
                      const st = STATUS_STYLES[iss.status];
                      return (
                        <tr key={iss.id} style={ui.tr}>
                          <td>#{iss.id}</td>
                          <td style={{ fontFamily: "monospace", fontWeight: 700, color: "#0284c7" }}>{iss.issueId}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{iss.issueType}</div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>{iss.location}</div>
                          </td>
                          <td><strong>{iss.priority}</strong></td>
                          <td>{iss.assignedTo || <span style={{ color: "#94a3b8" }}>Non affectée</span>}</td>
                          <td>
                            <span style={{ ...ui.statusPill, background: st.bg, color: st.color, borderColor: st.border }}>
                              {STATUS_LABELS[iss.status]}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => { setActiveTab("public"); inspectIssue(iss.id); }}
                              style={ui.miniBtn}
                            >
                              Voir Timeline
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredIssues.length === 0 && (
                      <tr><td colSpan="7" style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>Aucun signalement enregistré.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 3. IMPORT EXCEL ==================== */}
        {activeTab === "excel" && (
          <div style={ui.card}>
            <div style={ui.cardHeader}>
              <h2 style={ui.cardTitle}>Importation par lot (.xlsx / .csv)</h2>
              <span style={ui.tag}>SheetJS + Validation</span>
            </div>
            <p style={{ fontSize: "14px", color: "#64748b", marginBottom: "16px" }}>
              Colonnes attendues : <code>issueId</code>, <code>issueType</code>, <code>location</code>, <code>description</code>, <code>reportDate</code>, <code>priority</code>, <code>reportedBy</code>, <code>assignedTo</code>, <code>status</code>.
            </p>

            <div style={ui.dropzone}>
              <input type="file" id="excelFile" accept=".xlsx, .xls, .csv" onChange={handleExcelUpload} style={{ display: "none" }} />
              <label htmlFor="excelFile" style={{ cursor: "pointer", display: "block" }}>
                <strong>{fileName ? `Fichier chargé : ${fileName}` : "Cliquez ici pour importer urban_issues.xlsx"}</strong>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Validation automatique des champs avant envoi blockchain</div>
              </label>
            </div>

            {excelRows.length > 0 && (
              <div style={{ marginTop: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>
                    {excelRows.filter(r => r.selected).length} ligne(s) sélectionnée(s)
                  </span>
                  <button onClick={handleBatchImport} disabled={loading} style={{ ...ui.btn, background: "#16a34a" }}>
                    {loading ? "Import en cours..." : "Enregistrer la sélection sur Blockchain"}
                  </button>
                </div>

                <div style={ui.tableWrapper}>
                  <table style={ui.table}>
                    <thead>
                      <tr>
                        <th>✓</th>
                        <th>Code</th>
                        <th>Type</th>
                        <th>Lieu</th>
                        <th>Priorité</th>
                        <th>Statut</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelRows.map((row, idx) => (
                        <tr key={idx} style={{ ...ui.tr, background: row.valid ? (row.selected ? "#f0fdf4" : "#fff") : "#fef2f2" }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={!row.valid}
                              onChange={() => toggleExcelRow(idx)}
                            />
                          </td>
                          <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{row.data.issueId || "—"}</td>
                          <td>{row.data.issueType || "—"}</td>
                          <td>{row.data.location || "—"}</td>
                          <td>{row.data.priority || "—"}</td>
                          <td>{row.data.statusStr || "—"}</td>
                          <td>
                            {row.valid ? (
                              <span style={{ color: "#15803d", fontWeight: 700, fontSize: "12px" }}>✓ Valide</span>
                            ) : (
                              <span style={{ color: "#b91c1c", fontSize: "12px" }}>✗ {row.errors.join(", ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 4. CONSULTATION PUBLIQUE & HISTORIQUE ==================== */}
        {activeTab === "public" && (
          <div style={ui.card}>
            <div style={ui.cardHeader}>
              <h2 style={ui.cardTitle}>Consultation Publique & Traçabilité</h2>
              <span style={ui.tag}>Transparence Citoyenne</span>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); inspectIssue(searchQuery); }} style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <input
                type="text"
                placeholder="Rechercher par ID numérique (ex: 1) ou code (ex: CITY-2026-001)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...ui.input, flex: 1 }}
              />
              <button type="submit" style={{ ...ui.btn, background: "#0f172a" }}>Rechercher</button>
            </form>

            {inspectedIssue && (
              <div style={ui.detailCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: "14px", marginBottom: "16px" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>
                      Signalement #{inspectedIssue.id} · {inspectedIssue.issueId}
                    </div>
                    <h3 style={{ fontSize: "20px", color: "#0f172a", marginTop: "2px" }}>
                      {inspectedIssue.issueType} — {inspectedIssue.location}
                    </h3>
                  </div>
                  <span style={{
                    ...ui.statusPill,
                    background: STATUS_STYLES[inspectedIssue.status].bg,
                    color: STATUS_STYLES[inspectedIssue.status].color,
                    borderColor: STATUS_STYLES[inspectedIssue.status].border
                  }}>
                    {STATUS_LABELS[inspectedIssue.status]}
                  </span>
                </div>

                <p style={{ marginBottom: "16px", color: "#334155" }}>{inspectedIssue.description}</p>

                <div style={ui.metaGrid}>
                  <div><strong>Priorité :</strong> {inspectedIssue.priority}</div>
                  <div><strong>Date constat :</strong> {inspectedIssue.reportDate}</div>
                  <div><strong>Déclarant :</strong> {inspectedIssue.reportedBy}</div>
                  <div><strong>Équipe affectée :</strong> {inspectedIssue.assignedTo || "En attente d'affectation"}</div>
                  <div style={{ gridColumn: "span 2", fontSize: "12px", fontFamily: "monospace", color: "#475569" }}>
                    <strong>Wallet déclarant :</strong> {inspectedIssue.reporterWallet}
                  </div>
                </div>

                {/* TIMELINE HISTORIQUE */}
                <h4 style={{ marginTop: "22px", marginBottom: "12px", fontSize: "15px", color: "#0f172a" }}>
                  Historique vérifiable des interventions ({inspectedHistory.length} étapes)
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {inspectedHistory.map((h, i) => {
                    const st = STATUS_STYLES[h.status];
                    return (
                      <div key={i} style={ui.timelineItem}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <span style={{ ...ui.statusPill, background: st.bg, color: st.color, borderColor: st.border }}>
                            {STATUS_LABELS[h.status]}
                          </span>
                          <span style={{ fontSize: "12px", color: "#64748b" }}>
                            {new Date(h.timestamp * 1000).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>{h.comment}</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                          <span>Équipe : <strong>{h.assignedTo || "—"}</strong></span>
                          <span style={{ fontFamily: "monospace" }}>Acteur : {h.updatedBy}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

const ui = {
  wrapper: { minHeight: "100vh", padding: "32px 16px", background: "#f1f5f9" },
  container: { maxWidth: "940px", margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", gap: "12px", flexWrap: "wrap" },
  badgeTop: { display: "inline-block", background: "#e0f2fe", color: "#0369a1", fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "12px", textTransform: "uppercase", marginBottom: "6px" },
  title: { fontSize: "24px", fontWeight: 800, color: "#0f172a" },
  subtitle: { fontSize: "14px", color: "#64748b" },
  btn: { color: "#fff", border: "none", borderRadius: "8px", padding: "10px 16px", fontWeight: 600, fontSize: "14px", cursor: "pointer" },
  btnFull: { width: "100%", color: "#fff", border: "none", borderRadius: "8px", padding: "12px", fontWeight: 700, fontSize: "15px", cursor: "pointer" },
  miniBtn: { background: "#e2e8f0", border: "none", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", color: "#1e293b" },
  walletChip: { background: "#fff", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px 12px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "monospace", fontSize: "13px" },
  dot: { width: "8px", height: "8px", borderRadius: "50%" },

  tabs: { display: "flex", gap: "6px", background: "#e2e8f0", padding: "4px", borderRadius: "10px", marginBottom: "20px", flexWrap: "wrap" },
  tab: { flex: 1, minWidth: "150px", padding: "10px", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" },
  tabActive: { background: "#fff", color: "#0f172a", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
  tabInactive: { background: "transparent", color: "#64748b" },

  alert: { padding: "14px 16px", borderRadius: "8px", border: "1px solid", marginBottom: "18px", fontSize: "14px" },
  card: { background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "24px", marginBottom: "20px" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" },
  cardTitle: { fontSize: "18px", fontWeight: 700, color: "#0f172a" },
  tag: { background: "#f1f5f9", color: "#475569", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600 },

  gridTwo: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  formGroup: { display: "flex", flexDirection: "column", gap: "6px" },
  label: { fontSize: "13px", fontWeight: 600, color: "#334155" },
  input: { width: "100%", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "9px 12px", fontSize: "14px", background: "#fff" },

  tableWrapper: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  statusPill: { display: "inline-block", padding: "3px 10px", borderRadius: "14px", fontSize: "12px", fontWeight: 700, border: "1px solid" },

  dropzone: { border: "2px dashed #94a3b8", borderRadius: "10px", padding: "24px", textAlign: "center", background: "#f8fafc" },
  detailCard: { border: "1px solid #cbd5e1", borderRadius: "10px", padding: "20px", background: "#f8fafc" },
  metaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", background: "#fff", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "14px" },
  timelineItem: { background: "#fff", borderLeft: "4px solid #0284c7", padding: "12px 14px", borderRadius: "6px", border: "1px solid #e2e8f0", borderLeftWidth: "4px", borderLeftColor: "#0284c7" }
};