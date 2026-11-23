// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title UrbanIssueRegistry
 * @dev Registre décentralisé de signalements urbains (Smart City) avec traçabilité complète
 *      et gestion des rôles entre Citoyens et Municipalité.
 */
contract UrbanIssueRegistry is AccessControl {
    bytes32 public constant MUNICIPALITY_ROLE = keccak256("MUNICIPALITY_ROLE");
    uint256 public constant MAX_BATCH_SIZE = 50;

    enum IssueStatus {
        Reported,   // 0
        Assigned,   // 1
        InProgress, // 2
        Resolved,   // 3
        Closed      // 4
    }

    struct UrbanIssue {
        uint256 id;
        string issueId;       // Identifiant métier unique (ex: CITY-2026-001)
        string issueType;     // ex: StreetLight, RoadDamage, Waste, WaterLeak
        string location;      // ex: Avenue Mohammed V
        string description;
        string reportDate;    // Format ISO (YYYY-MM-DD)
        string priority;      // Low, Medium, High, Critical
        string reportedBy;    // Pseudonyme fictif (ex: Citizen01 - pas de PII)
        string assignedTo;    // Équipe affectée (ex: UrbanTeam01)
        IssueStatus status;
        address reporterWallet;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct HistoryEntry {
        uint256 timestamp;
        IssueStatus status;
        string assignedTo;
        string comment;
        address updatedBy;
    }

    // Structure utilisée pour l'import par lot depuis Excel
    struct IssueBatchInput {
        string issueId;
        string issueType;
        string location;
        string description;
        string reportDate;
        string priority;
        string reportedBy;
        string assignedTo;
        IssueStatus status;
    }

    uint256 private _nextId = 1;

    mapping(uint256 => UrbanIssue) private _issues;
    mapping(uint256 => HistoryEntry[]) private _issueHistory;
    mapping(string => bool) private _issueCodeRegistered;
    mapping(string => uint256) public codeToNumericId;

    // Événements de traçabilité
    event IssueReported(
        uint256 indexed id,
        string issueId,
        string issueType,
        string priority,
        address indexed reporterWallet
    );

    event TeamAssigned(
        uint256 indexed id,
        string assignedTo,
        address indexed updatedBy
    );

    event IssueStatusUpdated(
        uint256 indexed id,
        IssueStatus oldStatus,
        IssueStatus newStatus,
        string comment,
        address indexed updatedBy
    );

    event IssuesBatchImported(
        uint256 count,
        address indexed importedBy
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MUNICIPALITY_ROLE, msg.sender);
    }

    /**
     * @notice Déclaration d'un signalement urbain par un citoyen (ouvert à tout wallet)
     */
    function reportIssue(
        string calldata issueId,
        string calldata issueType,
        string calldata location,
        string calldata description,
        string calldata reportDate,
        string calldata priority,
        string calldata reportedBy
    ) external returns (uint256 id) {
        require(bytes(issueId).length > 0, "issueId requis");
        require(bytes(issueType).length > 0, "issueType requis");
        require(bytes(location).length > 0, "location requise");
        require(bytes(description).length > 0, "description requise");
        require(bytes(reportDate).length > 0, "reportDate requise");
        require(bytes(priority).length > 0, "priority requise");
        require(bytes(reportedBy).length > 0, "reportedBy requis");
        require(!_issueCodeRegistered[issueId], "Erreur: Cet issueId existe deja !");

        id = _nextId++;

        _issues[id] = UrbanIssue({
            id: id,
            issueId: issueId,
            issueType: issueType,
            location: location,
            description: description,
            reportDate: reportDate,
            priority: priority,
            reportedBy: reportedBy,
            assignedTo: "",
            status: IssueStatus.Reported,
            reporterWallet: msg.sender,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        _issueCodeRegistered[issueId] = true;
        codeToNumericId[issueId] = id;

        _issueHistory[id].push(HistoryEntry({
            timestamp: block.timestamp,
            status: IssueStatus.Reported,
            assignedTo: "",
            comment: "Signalement cree",
            updatedBy: msg.sender
        }));

        emit IssueReported(id, issueId, issueType, priority, msg.sender);
    }

    /**
     * @notice Import en masse depuis Excel/CSV (réservé aux agents municipaux)
     */
    function batchImportIssues(
        IssueBatchInput[] calldata inputs
    ) external onlyRole(MUNICIPALITY_ROLE) {
        uint256 total = inputs.length;
        require(total > 0, "Le lot ne peut pas etre vide");
        require(total <= MAX_BATCH_SIZE, "Lot trop grand (max 50)");

        for (uint256 i = 0; i < total; i++) {
            IssueBatchInput calldata item = inputs[i];
            require(bytes(item.issueId).length > 0, "issueId vide dans le lot");
            require(bytes(item.issueType).length > 0, "issueType vide dans le lot");
            require(bytes(item.location).length > 0, "location vide dans le lot");
            require(bytes(item.description).length > 0, "description vide dans le lot");
            require(bytes(item.reportDate).length > 0, "reportDate vide dans le lot");
            require(bytes(item.priority).length > 0, "priority vide dans le lot");
            require(bytes(item.reportedBy).length > 0, "reportedBy vide dans le lot");
            require(!_issueCodeRegistered[item.issueId], "Doublon d'issueId dans le lot");

            uint256 id = _nextId++;

            _issues[id] = UrbanIssue({
                id: id,
                issueId: item.issueId,
                issueType: item.issueType,
                location: item.location,
                description: item.description,
                reportDate: item.reportDate,
                priority: item.priority,
                reportedBy: item.reportedBy,
                assignedTo: item.assignedTo,
                status: item.status,
                reporterWallet: msg.sender,
                createdAt: block.timestamp,
                updatedAt: block.timestamp
            });

            _issueCodeRegistered[item.issueId] = true;
            codeToNumericId[item.issueId] = id;

            _issueHistory[id].push(HistoryEntry({
                timestamp: block.timestamp,
                status: item.status,
                assignedTo: item.assignedTo,
                comment: "Importe depuis fichier Excel",
                updatedBy: msg.sender
            }));

            emit IssueReported(id, item.issueId, item.issueType, item.priority, msg.sender);
        }

        emit IssuesBatchImported(total, msg.sender);
    }

    /**
     * @notice Affectation d'une équipe d'intervention (Municipalité uniquement)
     *         Passe automatiquement le statut de Reported à Assigned si nécessaire.
     */
    function assignTeam(
        uint256 id,
        string calldata team,
        string calldata comment
    ) external onlyRole(MUNICIPALITY_ROLE) {
        require(id > 0 && id < _nextId, "Signalement inexistant");
        require(bytes(team).length > 0, "Nom de l'equipe requis");

        UrbanIssue storage issue = _issues[id];
        require(issue.status != IssueStatus.Closed, "Signalement deja cloture");

        IssueStatus oldStatus = issue.status;
        issue.assignedTo = team;
        issue.updatedAt = block.timestamp;

        if (issue.status == IssueStatus.Reported) {
            issue.status = IssueStatus.Assigned;
            emit IssueStatusUpdated(id, oldStatus, IssueStatus.Assigned, comment, msg.sender);
        }

        string memory logComment = bytes(comment).length > 0
            ? comment
            : string.concat("Equipe affectee : ", team);

        _issueHistory[id].push(HistoryEntry({
            timestamp: block.timestamp,
            status: issue.status,
            assignedTo: team,
            comment: logComment,
            updatedBy: msg.sender
        }));

        emit TeamAssigned(id, team, msg.sender);
    }

    /**
     * @notice Mise à jour du statut d'un signalement (Municipalité uniquement)
     */
    function updateIssueStatus(
        uint256 id,
        IssueStatus newStatus,
        string calldata comment
    ) external onlyRole(MUNICIPALITY_ROLE) {
        require(id > 0 && id < _nextId, "Signalement inexistant");
        require(bytes(comment).length > 0, "Commentaire d'intervention requis");

        UrbanIssue storage issue = _issues[id];
        IssueStatus oldStatus = issue.status;
        require(oldStatus != IssueStatus.Closed, "Signalement deja cloture");
        require(uint8(newStatus) > uint8(oldStatus), "Transition de statut invalide (doit progresser)");

        issue.status = newStatus;
        issue.updatedAt = block.timestamp;

        _issueHistory[id].push(HistoryEntry({
            timestamp: block.timestamp,
            status: newStatus,
            assignedTo: issue.assignedTo,
            comment: comment,
            updatedBy: msg.sender
        }));

        emit IssueStatusUpdated(id, oldStatus, newStatus, comment, msg.sender);
    }

    /**
     * @notice Consultation d'un signalement par son ID numérique
     */
    function getIssue(uint256 id) external view returns (UrbanIssue memory) {
        require(id > 0 && id < _nextId, "Signalement inexistant");
        return _issues[id];
    }

    /**
     * @notice Consultation d'un signalement par son code métier (ex: CITY-2026-001)
     */
    function getIssueByCode(string calldata issueId) external view returns (UrbanIssue memory) {
        uint256 id = codeToNumericId[issueId];
        require(id > 0, "Code signalement inexistant");
        return _issues[id];
    }

    /**
     * @notice Consultation de l'historique complet d'un signalement
     */
    function getIssueHistory(uint256 id) external view returns (HistoryEntry[] memory) {
        require(id > 0 && id < _nextId, "Signalement inexistant");
        return _issueHistory[id];
    }

    /**
     * @notice Retourne tous les signalements pour affichage dans le tableau de bord
     */
    function getAllIssues() external view returns (UrbanIssue[] memory) {
        uint256 total = _nextId - 1;
        UrbanIssue[] memory list = new UrbanIssue[](total);
        for (uint256 i = 0; i < total; i++) {
            list[i] = _issues[i + 1];
        }
        return list;
    }

    /**
     * @notice Vérifie si un code issueId est déjà enregistré on-chain
     */
    function issueCodeExists(string calldata issueId) external view returns (bool) {
        return _issueCodeRegistered[issueId];
    }

    function totalIssues() external view returns (uint256) {
        return _nextId - 1;
    }
}