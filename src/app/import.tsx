import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Account } from '../db/repo';
import { importCsvRows } from '../sync/ingest';
import { AccountPicker } from '../components/pickers';
import { Body, Button, Card, Divider, Label, ListItem, Money, Row, Screen, Title } from '../components/ui';
import { ColumnMapping, detectColumns, parseCSV, rowsToTransactions, ParsedRow } from '../lib/csv';
import { formatDate } from '../lib/dates';

export default function ImportCsv() {
  const db = useSQLiteContext();
  const [fileName, setFileName] = useState<string | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [invert, setInvert] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    const text = await new File(asset.uri).text();
    const all = parseCSV(text);
    if (all.length < 2) return Alert.alert('That file has no rows.');
    const m = detectColumns(all[0]);
    if (!m) return Alert.alert('Unrecognized format', 'Need columns for date, description and amount (or debit/credit).');
    setFileName(asset.name);
    setHeader(all[0]);
    setRows(all.slice(1));
    setMapping(m);
  };

  const preview: { parsed: ParsedRow[]; skipped: number } = mapping ? rowsToTransactions(rows, mapping, { invert }) : { parsed: [], skipped: 0 };

  const run = async () => {
    if (!account) return Alert.alert('Choose the account these transactions belong to');
    setImporting(true);
    try {
      const added = await importCsvRows(db, { id: account.id, type: account.type }, preview.parsed);
      Alert.alert('Import complete', `${added} new transactions added${preview.parsed.length - added ? `, ${preview.parsed.length - added} already existed` : ''}.`);
      router.back();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Label style={{ marginBottom: 10 }}>
          Download transactions as CSV from your bank’s website, then pick the file. Re-importing the same file won’t create duplicates.
        </Label>
        <Button title={fileName ? `Change file (${fileName})` : 'Choose CSV file'} icon="document" variant="secondary" onPress={pick} />
      </Card>

      {mapping && (
        <>
          <Card>
            <Title>Columns</Title>
            <Label>Date: {header[mapping.date]} · Description: {header[mapping.description]}</Label>
            <Label>
              {mapping.amount != null ? `Amount: ${header[mapping.amount]}` : `Debit: ${header[mapping.debit!]} · Credit: ${header[mapping.credit!]}`}
            </Label>
            <Divider />
            <Row style={{ justifyContent: 'space-between', paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Body>Flip signs</Body>
                <Label>Turn on if purchases show as positive (common for card exports).</Label>
              </View>
              <Switch value={invert} onValueChange={setInvert} />
            </Row>
          </Card>

          <Card>
            <ListItem
              icon={account?.type === 'credit' ? 'card' : 'wallet'}
              title={account?.name ?? 'Choose account'}
              subtitle="Import into"
              onPress={() => setPicking(true)}
            />
          </Card>

          <Card>
            <Title>Preview</Title>
            <Label style={{ marginBottom: 6 }}>
              {preview.parsed.length} transactions{preview.skipped ? `, ${preview.skipped} rows skipped` : ''}
            </Label>
            {preview.parsed.slice(0, 8).map((t, i) => (
              <View key={i}>
                {i > 0 && <Divider />}
                <ListItem title={t.description} subtitle={formatDate(t.date, { month: 'short', day: 'numeric', year: 'numeric' })} right={<Money amount={t.amount} colored />} />
              </View>
            ))}
          </Card>

          <Button title={`Import ${preview.parsed.length} transactions`} loading={importing} disabled={!preview.parsed.length} onPress={run} />
        </>
      )}
      <AccountPicker visible={picking} onClose={() => setPicking(false)} onPick={setAccount} />
    </Screen>
  );
}
