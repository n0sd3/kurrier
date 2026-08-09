export const dynamic = "force-dynamic"; // or

import React, { useEffect, useState } from "react";
import IsVerifiedStatus from "../providers/is-verified-status";
import {
	FetchGoogleAccountsResultRow,
	FetchUserIdentitiesResult,
	getIdentityById,
} from "@/lib/actions/dashboard";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

function EmailIdentityStatus({
	userIdentity,
	googleAccount,
}: {
	userIdentity: FetchUserIdentitiesResult[number];
	googleAccount?: FetchGoogleAccountsResultRow;
}) {
	const [incoming, setIncoming] = useState<boolean>(false);
	const evaluateStatus = async () => {
		if (userIdentity.identities.domainIdentityId) {
			const domain = await getIdentityById(
				userIdentity.identities.domainIdentityId,
			);
			setIncoming(!!domain.incomingDomain);
		}
	};

	useEffect(() => {
		if (userIdentity) {
			evaluateStatus();
		}
	}, [userIdentity]);

	// Google identities send and receive through the Gmail API, so there is no
	// inbound domain to check: the granted OAuth scopes are the real signal.
	if (googleAccount) {
		const connected =
			googleAccount.status === "connected" && !googleAccount.lastError;
		const scopes = googleAccount.scopes ?? [];

		return (
			<>
				<IsVerifiedStatus
					verified={connected && scopes.includes(GMAIL_SEND_SCOPE)}
					statusName="Outgoing"
				/>
				<IsVerifiedStatus
					verified={connected && scopes.includes(GMAIL_MODIFY_SCOPE)}
					statusName="Incoming"
				/>
			</>
		);
	}

	return (
		<>
			<IsVerifiedStatus verified={true} statusName="Outgoing" />
			<IsVerifiedStatus verified={incoming} statusName="Incoming" />
		</>
	);
}

export default EmailIdentityStatus;
