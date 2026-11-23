const { expect } = require("chai");
const { ethers } = require("hardhat");
const XLSX = require("xlsx");

describe("UrbanIssueRegistry — Smart City & Traçabilité", function () {
  let registry, admin, citizen1, citizen2, agent2;
  let MUNICIPALITY_ROLE, DEFAULT_ADMIN_ROLE;

  const STATUS_MAP = {
    Reported: 0,
    Assigned: 1,
    InProgress: 2,
    Resolved: 3,
    Closed: 4,
  };

  beforeEach(async function () {
    [admin, citizen1, citizen2, agent2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("UrbanIssueRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();

    MUNICIPALITY_ROLE = await registry.MUNICIPALITY_ROLE();
    DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  });

  it("1. Initialise correctement les rôles (Admin & Municipalité)", async function () {
    expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await registry.hasRole(MUNICIPALITY_ROLE, admin.address)).to.be.true;
    expect(await registry.hasRole(MUNICIPALITY_ROLE, citizen1.address)).to.be.false;
  });

  it("2. Permet à n'importe quel citoyen de déclarer un signalement et initialise l'historique", async function () {
    await expect(
      registry.connect(citizen1).reportIssue(
        "CITY-2026-001",
        "StreetLight",
        "Avenue Mohammed V",
        "Panne d'eclairage public",
        "2026-11-19",
        "High",
        "Citizen01"
      )
    )
      .to.emit(registry, "IssueReported")
      .withArgs(1, "CITY-2026-001", "StreetLight", "High", citizen1.address);

    expect(await registry.totalIssues()).to.equal(1);
    expect(await registry.issueCodeExists("CITY-2026-001")).to.be.true;

    const issue = await registry.getIssue(1);
    expect(issue.issueId).to.equal("CITY-2026-001");
    expect(issue.status).to.equal(0); // Reported
    expect(issue.reporterWallet).to.equal(citizen1.address);

    const history = await registry.getIssueHistory(1);
    expect(history.length).to.equal(1);
    expect(history[0].comment).to.equal("Signalement cree");
    expect(history[0].updatedBy).to.equal(citizen1.address);
  });

  it("3. Bloque les doublons d'issueId et les champs obligatoires vides", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-001",
      "StreetLight",
      "Avenue Mohammed V",
      "Lampadaire casse",
      "2026-11-19",
      "High",
      "Citizen01"
    );

    await expect(
      registry.connect(citizen2).reportIssue(
        "CITY-2026-001",
        "Waste",
        "Autre rue",
        "Doublon",
        "2026-11-20",
        "Low",
        "Citizen02"
      )
    ).to.be.revertedWith("Erreur: Cet issueId existe deja !");

    await expect(
      registry.connect(citizen1).reportIssue("", "Waste", "Rue X", "Desc", "2026-11-20", "Low", "Citizen01")
    ).to.be.revertedWith("issueId requis");
  });

  it("4. Permet la consultation publique par code (getIssueByCode) et la liste complète (getAllIssues)", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-010",
      "WaterLeak",
      "Place des Nations",
      "Fuite d'eau",
      "2026-11-20",
      "Critical",
      "Citizen05"
    );

    const byCode = await registry.getIssueByCode("CITY-2026-010");
    expect(byCode.id).to.equal(1);
    expect(byCode.location).to.equal("Place des Nations");

    const all = await registry.getAllIssues();
    expect(all.length).to.equal(1);
    expect(all[0].issueId).to.equal("CITY-2026-010");
  });

  it("5. Permet à la municipalité d'affecter une équipe (passe Reported -> Assigned)", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-001",
      "StreetLight",
      "Avenue Mohammed V",
      "Panne",
      "2026-11-19",
      "High",
      "Citizen01"
    );

    await expect(registry.assignTeam(1, "UrbanTeam01", "Equipe electricite envoyee"))
      .to.emit(registry, "TeamAssigned")
      .withArgs(1, "UrbanTeam01", admin.address);

    const issue = await registry.getIssue(1);
    expect(issue.assignedTo).to.equal("UrbanTeam01");
    expect(issue.status).to.equal(1); // Assigned

    const history = await registry.getIssueHistory(1);
    expect(history.length).to.equal(2);
    expect(history[1].assignedTo).to.equal("UrbanTeam01");
    expect(history[1].comment).to.equal("Equipe electricite envoyee");
  });

  it("6. Refuse les actions municipales (assignTeam, updateIssueStatus, batchImport) à un simple citoyen", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-001",
      "StreetLight",
      "Avenue Mohammed V",
      "Panne",
      "2026-11-19",
      "High",
      "Citizen01"
    );

    await expect(
      registry.connect(citizen1).assignTeam(1, "FakeTeam", "Tentative")
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");

    await expect(
      registry.connect(citizen1).updateIssueStatus(1, 2, "Hack")
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");

    await expect(
      registry.connect(citizen1).batchImportIssues([])
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("7. Trace l'historique complet : Reported -> Assigned -> InProgress -> Resolved -> Closed", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-001",
      "StreetLight",
      "Avenue Mohammed V",
      "Panne d'eclairage",
      "2026-11-19",
      "High",
      "Citizen01"
    );

    await registry.assignTeam(1, "UrbanTeam01", "Prise en charge par UrbanTeam01");
    await registry.updateIssueStatus(1, 2, "Remplacement du cable en cours"); // InProgress
    await registry.updateIssueStatus(1, 3, "Eclairage retabli et teste");     // Resolved
    await registry.updateIssueStatus(1, 4, "Validation finale municipalite"); // Closed

    const issue = await registry.getIssue(1);
    expect(issue.status).to.equal(4); // Closed

    const history = await registry.getIssueHistory(1);
    expect(history.length).to.equal(5);
    expect(history[0].status).to.equal(0);
    expect(history[1].status).to.equal(1);
    expect(history[2].status).to.equal(2);
    expect(history[3].status).to.equal(3);
    expect(history[4].status).to.equal(4);
    expect(history[4].comment).to.equal("Validation finale municipalite");
  });

  it("8. Bloque les transitions invalides, commentaires vides et modifications après Closed", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-001",
      "StreetLight",
      "Avenue Mohammed V",
      "Panne",
      "2026-11-19",
      "High",
      "Citizen01"
    );

    await expect(registry.updateIssueStatus(1, 2, "")).to.be.revertedWith(
      "Commentaire d'intervention requis"
    );

    await registry.updateIssueStatus(1, 3, "Repare rapidement"); // Resolved (3)

    // Tentative de retour en arrière (InProgress = 2)
    await expect(registry.updateIssueStatus(1, 2, "Retour arriere")).to.be.revertedWith(
      "Transition de statut invalide (doit progresser)"
    );

    // Clôture
    await registry.updateIssueStatus(1, 4, "Cloture");

    // Impossible de modifier après clôture
    await expect(registry.assignTeam(1, "TeamX", "Reouverture")).to.be.revertedWith(
      "Signalement deja cloture"
    );
  });

  it("9. Importe plusieurs signalements depuis le fichier réel 'urban_issues.xlsx'", async function () {
    const wb = XLSX.readFile("urban_issues.xlsx");
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const inputs = rows.map((r) => ({
      issueId: String(r.issueId),
      issueType: String(r.issueType),
      location: String(r.location),
      description: String(r.description),
      reportDate: String(r.reportDate),
      priority: String(r.priority),
      reportedBy: String(r.reportedBy),
      assignedTo: String(r.assignedTo || ""),
      status: STATUS_MAP[r.status] ?? 0,
    }));

    await expect(registry.batchImportIssues(inputs))
      .to.emit(registry, "IssuesBatchImported")
      .withArgs(rows.length, admin.address);

    expect(await registry.totalIssues()).to.equal(rows.length);

    const first = await registry.getIssue(1);
    expect(first.issueId).to.equal("CITY-2026-001");
    expect(first.assignedTo).to.equal("UrbanTeam01");
  });

  it("10. Permet à l'Admin d'ajouter un autre agent municipal (MUNICIPALITY_ROLE)", async function () {
    await registry.connect(citizen1).reportIssue(
      "CITY-2026-099",
      "RoadDamage",
      "Rue Tanger",
      "Nid de poule",
      "2026-11-22",
      "Medium",
      "Citizen09"
    );

    await registry.grantRole(MUNICIPALITY_ROLE, agent2.address);
    await registry.connect(agent2).assignTeam(1, "RoadTeam01", "Prise en charge par agent 2");

    const issue = await registry.getIssue(1);
    expect(issue.assignedTo).to.equal("RoadTeam01");
  });
});