import React, { useEffect, useState } from 'react';
import { View, ScrollView, Text, StyleSheet,Image, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { db } from '../firebaseConfig';
import { getDoc, doc } from 'firebase/firestore';
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI('AIzaSyDPqWClK0eFXlTF-C8F4T-kxpk42dOI1sg'); // Replace with your actual API key


const SubmitAnswerScreen = ({ route, navigation }) => {
  const { modelId } = route.params;
  const { results } = route.params;
  const [studentName, setStudentName] = useState('');
  const [expandedItems, setExpandedItems] = useState({});
  const [loading, setLoading] = useState(false);
  const [modelData, setModelData] = useState(null);

  

  useEffect(() => {
    console.log('Fetching model data for modelId:', modelId); // First log
    const fetchData = async () => {
      try{
      console.log('Creating document reference...');
      const ModelRef = doc(db, 'models', modelId);
      console.log('Fetching document snapshot...');

      const ModelSnap = await getDoc(ModelRef);
      console.log('Snapshot received:', ModelSnap);

  
      if (ModelSnap.exists()) {
        const data = ModelSnap.data()
        console.log('Type of modelData:', Array.isArray(data) ? 'Array' : typeof data);
        console.log('Document data:', JSON.stringify(data, null, 2));
        console.log('Full ModelSnap:', ModelSnap);
        console.log('ModelSnap data:', data);
        console.log("AnswerSnap data:", results);
        setModelData(ModelSnap.data());
      } else {
        console.warn('No document found for modelId:', modelId);
      }
    } catch (error) {
      console.error('Error fetching model data:', error);
    }
    };
  
    fetchData();
  }, [modelId]);
  

  const toggleExpand = (resultIndex, pairIndex) => {
    setExpandedItems(prev => ({
      ...prev,
      [`${resultIndex}-${pairIndex}`]: !prev[`${resultIndex}-${pairIndex}`]
    }));
  };

  const compareAnswersWithAI = async (studentAnswer, modelAnswer ,maxMark) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = ` You're an exam evaluator. Compare the following student's answer with the model answer and give a mark out of ${maxMark}.

      
      Model Answer: "${modelAnswer}"
      
      Student Answer: "${studentAnswer}"
      
      Give a JSON response in the exact format:
{
  "markAwarded": number, // (should be between 0 and ${maxMark})
  "explanation": string
}
`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      const jsonString = text.slice(jsonStart, jsonEnd);
      // Parse the JSON response
      try {
        const parsedResponse = JSON.parse(jsonString);
        return {
          awardedMarks: Math.min(Math.max(parseInt(parsedResponse.markAwarded), 0), maxMark),
          explanation: parsedResponse.explanation || "No explanation provided."
        };
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        console.log('Raw AI response:', text);
        // Fallback to exact match if parsing fails
        return {
          awardedMarks: 0,
          explanation: 'Parsing failed, defaulted to 0 marks.'
        };

      }
      
    } catch (error) {
      console.error('AI comparison error:', error);
      return {
        awardedMarks: 0,
        explanation: 'AI failed, defaulted to 0 marks.'
      };
    }
  };

  const compareQuestionsWithAI = async (studentQuestion, modelQuestion) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      
      const prompt = `Determine if these two questions are the same, ignoring extra spaces or minor formatting differences:
      
      Model Question: "${modelQuestion}"
      
      Student Question: "${studentQuestion}"
      
      Return ONLY a JSON object with this exact structure:
      {
        "isSame": boolean,
        "explanation": string
      }`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Extract JSON from response
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      const jsonString = text.slice(jsonStart, jsonEnd);
      
      try {
        const parsedResponse = JSON.parse(jsonString);
        return parsedResponse.isSame;
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        console.log('Raw AI response:', text);
        // Fallback to basic comparison if parsing fails
        return studentQuestion.trim() === modelQuestion.trim();
      }
      
    } catch (error) {
      console.error('Error comparing questions with AI:', error);
      return studentQuestion.trim() === modelQuestion.trim();
    }
  };


  // Submit answers to Firestore
  const submitAnswers = async () => {
    if (!studentName.trim()) {
      Alert.alert('Error', 'Please enter student name');
      return;
    }
    if (!modelData) {
      Alert.alert('Error', 'Model data not loaded yet');
      return;
    }
    if (!results || !results[0]?.qa_dict) {
      Alert.alert('Error', 'Student answers are missing or invalid');
      return;
    }
    setLoading(true);
    try {
      // Create an array to store evaluation results
      const evaluationResults = [];
      let allCroppedPairs = [];
      

      const totalPossible = modelData.data.reduce(
        (sum, item) => sum + parseInt(item.mark || 0), 
              0
            );
            for (const result of results) {
              if (!result?.qa_dict) {
                console.warn('Result missing qa_dict:', result);
                continue;
              }
      
              // Collect all cropped pairs from all results
              if (result.cropped_pairs) {
                allCroppedPairs = [...allCroppedPairs, ...result.cropped_pairs];
              }
      
              const qaDict = result.qa_dict;
        // Compare each question in the student's answers with the model data
        for (const [studentQuestionKey, studentAnswer] of Object.entries(qaDict)) {
          try {
            let matchedQuestion = modelData.data.find(
              item => item.question.trim() === studentQuestionKey.trim()
            );
  
          if (!matchedQuestion) {
            console.log(`No exact match for "${studentQuestionKey}", trying AI comparison`);
            for (const modelQuestion of modelData.data) {
              const isSame = await compareQuestionsWithAI(
                studentQuestionKey,
                modelQuestion.question
              );
              if (isSame) {
                matchedQuestion = modelQuestion;
                console.log(`AI matched "${studentQuestionKey}" with "${modelQuestion.question}"`);
                break;
              }
            }
          }

          if (!matchedQuestion) {
            console.warn(`Question "${studentQuestionKey}" not found in model data`);
            continue; // Skip to next question if no match found
          }

          const evaluation = await compareAnswersWithAI(
            studentAnswer, 
            matchedQuestion.answer,
            parseInt(matchedQuestion.mark)
          );
            
            evaluationResults.push({
              question: matchedQuestion.question, // Use the model's question text
              studentQuestion: studentQuestionKey, // Keep original student question
              studentAnswer,
              correctAnswer: matchedQuestion.answer,
              isCorrect: evaluation.awardedMarks === parseInt(matchedQuestion.mark),
              explanation: evaluation.explanation,
              marks: evaluation.awardedMarks,
              totalMarks: parseInt(matchedQuestion.mark)
            });
          } catch (error) {
            console.error(`Error processing question "${studentQuestionKey}":`, error);
            // Continue with next question even if one fails
            continue;
          }}
        }
  
      // Calculate total score
      const totalScore = evaluationResults.reduce(
        (sum, result) => sum + result.marks, 
        0
      );
      
  
      console.log('Evaluation results:', evaluationResults);
      console.log(`Score: ${totalScore}/${totalPossible}`);
  
      const finalData = {
        evaluationResults,
        totalScore,
        totalPossible,
        studentName,
      };
      // Show results to user
      
      navigation.navigate('SaveResultsScreen', { finalData,croppedPairs: allCroppedPairs})
  
    } catch (error) {
      console.error('Error evaluating answers:', error);
      Alert.alert('Error', 'Failed to evaluate answers');
    } finally {
      setLoading(false);
    }
  
    
  };
  

  return (
    <View style={styles.mainContainer}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Submit Answers</Text>

        {/* Student Name Input */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Student Name:</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Enter student name"
            value={studentName}
            onChangeText={setStudentName}
          />
        </View>

       {results.map((result, resultIndex) => (
       
               <View key={resultIndex} style={styles.resultBlock}>
                 
                
                 {result.cropped_pairs.map((base64Image, pairIndex) => (
                   <View key={pairIndex} style={styles.card}>
       
       
                     <TouchableOpacity
                       style={styles.cardHeader}
                       onPress={() => toggleExpand(resultIndex, pairIndex)}
                     >
                       <Text style={styles.cardTitle}>
                         Question {resultIndex + 1}-{pairIndex + 1}
                       </Text>
                       <Text style={styles.expandIcon}>
                         {expandedItems[`${resultIndex}-${pairIndex}`] ? '▲' : '▼'}
                       </Text>
                     </TouchableOpacity>
       
                     {expandedItems[`${resultIndex}-${pairIndex}`] && (
                       <View style={styles.cardContent}>
                         <Image
                           source={{ uri: base64Image }}
                           style={styles.image}
                           resizeMode="contain"
                         />
                       </View>
                     )}
                   </View>
                 ))}
               </View>
             ))}

       
      </ScrollView>

      {/* Submit Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={styles.submitButton}
          onPress={submitAnswers}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="cloud-upload" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Evaluate Answers</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  container: {
    padding: 20,
    paddingBottom: 100
  },
  heading: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  inputCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  answerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#f9f9f9',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    marginTop: 8,
  },
  addButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    elevation: 3,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  cardContent: {
    padding: 15,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
    marginTop: 10,
  },
  resultBlock: {
    marginBottom: 15,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});

export default SubmitAnswerScreen;