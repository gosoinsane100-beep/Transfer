import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';

export default function App() {
  const [amountUSD, setAmountUSD] = useState('100');
  const [rate, setRate] = useState(2700);
  const [loading, setLoading] = useState(false);

  const platformFeePercent = 0.05; // 5% fee
  const usdAfterFee = parseFloat(amountUSD || 0) * (1 - platformFeePercent);
  const sdgAmount = (usdAfterFee * rate).toLocaleString();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>USD to SDG Transfer</Text>
        <Text style={styles.subtitle}>تحويل دولار إلى جنيه سوداني (بنكك)</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>You Send (USD):</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={amountUSD}
            onChangeText={setAmountUSD}
            placeholder="100"
          />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>Platform Fee: 5%</Text>
          <Text style={styles.infoText}>Exchange Rate: $1 = {rate} SDG</Text>
        </View>

        <View style={styles.resultContainer}>
          <Text style={styles.resultLabel}>Recipient Receives (Bankak):</Text>
          <Text style={styles.resultValue}>{sdgAmount} SDG</Text>
        </View>

        <TouchableOpacity style={styles.button}>
          <Text style={styles.buttonText}>Continue Transfer / متابعة</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1a1a1a', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 20, marginTop: 4 },
  inputContainer: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, fontSize: 18, backgroundColor: '#fafafa' },
  infoBox: { backgroundColor: '#eef2ff', padding: 12, borderRadius: 8, marginBottom: 16 },
  infoText: { fontSize: 13, color: '#3730a3', marginVertical: 2 },
  resultContainer: { alignItems: 'center', marginVertical: 16, padding: 12, backgroundColor: '#f0fdf4', borderRadius: 10 },
  resultLabel: { fontSize: 14, color: '#166534', fontWeight: '600' },
  resultValue: { fontSize: 26, fontWeight: 'bold', color: '#15803d', marginTop: 4 },
  button: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
